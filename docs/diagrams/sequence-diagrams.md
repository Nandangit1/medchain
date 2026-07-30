# Sequence Diagrams

## 1. Upload a medical record

```mermaid
sequenceDiagram
    autonumber
    actor P as Patient
    participant UI as React UI
    participant API as Express
    participant MW as Multer + validators
    participant SVC as medicalRecordService
    participant ENC as encryptionService
    participant IPFS as ipfsService
    participant DB as MongoDB
    participant BC as blockchainService
    participant CON as TelemedicineRecords

    P->>UI: choose file, fill metadata
    UI->>UI: validate MIME + size locally
    UI->>API: POST /records (multipart, Bearer)
    API->>MW: protect → authorize(patient) → upload → validate
    MW-->>API: req.file (in memory), req.body
    API->>SVC: uploadRecord(actor, file, payload)

    SVC->>SVC: sha256(plaintext) → fileHash
    SVC->>DB: existsByPatientAndHash(patient, fileHash)
    DB-->>SVC: false

    SVC->>ENC: encryptBuffer(plaintext)
    ENC->>ENC: random CEK + IV, AES-256-GCM
    ENC->>ENC: wrap CEK with master key
    ENC-->>SVC: ciphertext + envelope

    SVC->>IPFS: upload(ciphertext)
    IPFS-->>SVC: CID

    SVC->>DB: create(record + envelope)
    DB-->>SVC: record

    SVC->>BC: anchorRecord(patient, record)
    BC->>BC: ensureParticipantRegistered
    BC->>CON: anchorRecord(addr, hash, cid, type)
    CON-->>BC: RecordAnchored(recordId)
    BC->>DB: log BlockchainTransaction
    BC-->>SVC: {confirmed, onChainId, txHash}

    SVC->>DB: save blockchain sub-document
    SVC-->>API: record (encryption stripped)
    API-->>UI: 201 Created
    UI-->>P: "Uploaded, encrypted and anchored"

    Note over SVC,IPFS: If the DB write fails after pinning,<br/>the CID is unpinned so no orphan remains.
    Note over BC: anchorRecord never throws.<br/>A chain outage leaves status "pending".
```

## 2. Patient grants a doctor access

```mermaid
sequenceDiagram
    autonumber
    actor P as Patient
    participant UI as ShareModal
    participant API as Express
    participant ACS as accessControlService
    participant DB as MongoDB
    participant BC as blockchainService
    participant CON as TelemedicineRecords
    participant NS as notificationService
    participant AS as auditService
    actor D as Doctor

    P->>UI: open Share
    UI->>API: GET /doctors/directory
    API-->>UI: verified doctors only
    P->>UI: pick doctor, optional expiry
    UI->>API: POST /records/:id/share

    API->>ACS: grantAccess(actor, recordId, doctorId, expiresAt)
    ACS->>DB: load record, assert ownership
    ACS->>DB: load doctor, assert VERIFIED
    ACS->>DB: reject if a live grant already exists
    ACS->>DB: create AccessPermission

    ACS->>BC: grantAccessOnChain(record, doctor)
    BC->>CON: isVerifiedDoctor(addr)
    alt not yet verified on-chain
        BC->>CON: verifyDoctor(addr)
    end
    BC->>CON: grantAccessFor(recordId, addr, expiry)
    CON-->>BC: AccessGranted(custodial=true)
    BC-->>ACS: {confirmed, txHash}

    ACS->>DB: save grantTx
    ACS->>AS: record(ACCESS_GRANTED)
    ACS->>NS: push(doctor, "record shared")
    ACS-->>API: permission
    API-->>UI: 201 Created
    NS-->>D: bell badge increments

    Note over ACS,CON: The contract refuses a grant to an<br/>unverified doctor, so the off-chain check<br/>is mirrored before the call.
```

## 3. Doctor reads a shared record

```mermaid
sequenceDiagram
    autonumber
    actor D as Doctor
    participant UI as React UI
    participant API as Express
    participant MRS as medicalRecordService
    participant ACS as accessControlService
    participant DB as MongoDB
    participant CON as TelemedicineRecords
    participant IPFS as ipfsService
    participant ENC as encryptionService
    actor P as Patient

    D->>UI: open record, click Download
    UI->>API: GET /records/:id/download (Bearer)
    API->>MRS: downloadRecord(actor, recordId)
    MRS->>DB: findByIdWithSecrets (+encryption)

    MRS->>MRS: not owner, not admin → doctor path
    MRS->>MRS: assert verificationStatus = verified
    MRS->>ACS: doctorCanRead(doctor, record)
    ACS->>DB: findLive(record, doctor)
    DB-->>ACS: live permission
    ACS->>CON: hasAccess(onChainId, addr)
    CON-->>ACS: true
    ACS-->>MRS: true

    MRS->>IPFS: fetchByCid(cid)
    IPFS-->>MRS: ciphertext
    MRS->>ENC: decryptBuffer(ciphertext, envelope)
    ENC->>ENC: unwrap CEK, verify GCM tag
    ENC-->>MRS: plaintext
    MRS->>MRS: sha256(plaintext) == integrity.fileHash?

    MRS->>CON: logAccess(recordId, addr) [async]
    MRS->>DB: notify patient "a doctor opened your record"
    MRS->>DB: audit RECORD_DOWNLOADED
    MRS-->>API: buffer + record
    API-->>UI: 200, Cache-Control: no-store
    UI-->>D: file downloaded
    Note over P: Patient sees the access in their<br/>notifications and on-chain history.

    Note over ACS,CON: If the chain is unreachable, hasAccess<br/>returns null and the DB decision stands.<br/>The chain can veto, never widen.
```

## 4. Revoking access

```mermaid
sequenceDiagram
    autonumber
    actor P as Patient
    participant API as Express
    participant ACS as accessControlService
    participant DB as MongoDB
    participant CON as TelemedicineRecords
    actor D as Doctor

    P->>API: DELETE /records/:id/share/:doctorId
    API->>ACS: revokeAccess(...)
    ACS->>DB: assert ownership
    ACS->>DB: find live permission
    ACS->>DB: set revokedAt (row is NOT deleted)
    ACS->>CON: revokeAccess(recordId, addr)
    CON-->>ACS: AccessRevoked event
    ACS->>DB: save revokeTx + audit + notify
    ACS-->>API: permission (live = false)

    D->>API: GET /records/:id
    API->>ACS: doctorCanRead
    ACS->>DB: findLive → none
    ACS-->>API: false
    API-->>D: 403 Forbidden

    Note over CON: revokeAccess works even while the<br/>contract is paused — withdrawing consent<br/>must never be blocked by an incident.
```

## 5. Session refresh with rotation

```mermaid
sequenceDiagram
    autonumber
    participant UI as React (Axios)
    participant API as Express
    participant TS as tokenService
    participant DB as Token collection

    Note over UI: Access token expires mid-session.
    UI->>API: GET /records (expired Bearer)
    API-->>UI: 401

    Note over UI: Single-flight: concurrent 401s<br/>await ONE refresh promise.
    UI->>API: POST /auth/refresh (httpOnly cookie)
    API->>TS: rotateRefreshToken(raw)
    TS->>DB: find by sha256(raw)

    alt token already used
        TS->>DB: revoke ALL refresh tokens for user
        TS-->>API: 401 "reused and revoked"
        API-->>UI: force sign-in
    else token valid
        TS->>DB: create replacement
        TS->>DB: mark original used, set replacedBy
        TS-->>API: user + new refresh token
        API-->>UI: 200 new access token + Set-Cookie
        UI->>API: retry original request
        API-->>UI: 200
    end
```

**Why single-flight matters.** Because reuse triggers family-wide revocation, N
parallel refresh calls would make the 2nd through Nth present an already-spent
token and log the user out. The client must serialise refreshes; the frontend
interceptor shares one promise across all queued requests.

## 6. Admin verifies a doctor

```mermaid
sequenceDiagram
    autonumber
    actor A as Admin
    participant API as Express
    participant DB as MongoDB
    participant BC as blockchainService
    participant CON as TelemedicineRecords
    actor D as Doctor

    A->>API: PATCH /admin/doctors/:id/verify
    API->>DB: assert doctor exists and is active
    API->>DB: verificationStatus = verified, verifiedBy, verifiedAt
    API->>BC: verifyDoctorOnChain(doctor, adminId)
    BC->>CON: ensureParticipantRegistered → registerDoctor
    BC->>CON: verifyDoctor(addr)
    CON-->>BC: DoctorVerified event
    BC->>DB: log BlockchainTransaction
    API->>DB: audit DOCTOR_VERIFIED
    API->>DB: notify doctor
    API-->>A: 200 + onChain result
    Note over D: Doctor's portal unlocks; patients<br/>can now share records with them.

    Note over API,BC: On-chain mirroring is best-effort.<br/>The off-chain decision stands either way,<br/>and grantAccessOnChain self-heals later.
```
