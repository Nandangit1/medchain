# Class Diagram

JavaScript modules rather than literal classes, so this shows the *layer
contracts*: what each module exposes and what it depends on. The dependency
arrows all point one way, which is the property that keeps the layers honest.

## Backend layers

```mermaid
classDiagram
    direction TB

    class MedicalRecordController {
        <<HTTP adapter>>
        +uploadRecord(req, res)
        +getRecords(req, res)
        +getRecordById(req, res)
        +downloadRecord(req, res)
        +verifyRecordIntegrity(req, res)
        +updateRecord(req, res)
        +deleteRecord(req, res)
    }

    class MedicalRecordService {
        <<business logic>>
        -createRecord(actor, patient, file, payload)
        -assertCanViewMetadata(actor, record) async
        -assertCanReadContent(actor, record) async
        -buildListFilter(actor, query) async
        +uploadRecord(...)
        +uploadRecordForPatient(...)
        +listRecords(...)
        +getRecordById(...)
        +downloadRecord(...)
        +verifyRecordIntegrity(...)
        +updateRecordMetadata(...)
        +deleteRecord(...)
    }

    class AccessControlService {
        <<business logic>>
        +grantAccess(...)
        +revokeAccess(...)
        +doctorCanRead(doctor, record) bool
        +grantSystemAccess(...)
        +listLiveRecordIdsForDoctor(id)
        +getRecordHistory(...)
    }

    class EncryptionService {
        <<crypto>>
        -getMasterKey()
        -wrapContentKey(cek)
        -unwrapContentKey(envelope)
        +encryptBuffer(plaintext) ciphertext_envelope
        +decryptBuffer(ciphertext, envelope) plaintext
    }

    class IpfsService {
        <<factory>>
        -activeDriver
        +upload(buffer, options)
        +fetchByCid(cid)
        +unpin(cid)
        +name
    }

    class LocalDriver {
        +upload(buffer, options)
        +fetchByCid(cid)
        +unpin(cid)
    }

    class PinataDriver {
        +upload(buffer, options)
        +fetchByCid(cid)
        +unpin(cid)
    }

    class BlockchainService {
        <<chain gateway>>
        -submissionQueue
        -cachedNonce
        -enqueue(task)
        -submit(buildCall)
        +deriveCustodialAddress(userId)
        +ensureParticipantRegistered(user)
        +anchorRecord(...)
        +grantAccessOnChain(...)
        +revokeAccessOnChain(...)
        +hasAccessOnChain(...)
        +logAccessOnChain(...)
        +getRecordHistory(onChainId)
        +verifyOnChain(...)
        +getStatus()
    }

    class MedicalRecordRepository {
        <<persistence>>
        -notDeleted(filter)
        +create(payload)
        +findById(id)
        +findByIdWithSecrets(id)
        +findManyPaginated(filter, pagination)
        +updateById(id, updates)
        +softDeleteById(id, by)
        +existsByPatientAndHash(...)
    }

    class AccessPermissionRepository {
        <<persistence>>
        -liveFilter()
        +create(payload)
        +findLive(recordId, doctorId)
        +findLiveForDoctor(doctorId)
        +revoke(id, by)
    }

    class AuditService {
        +record(entry) never_throws
        +list(query)
        +summary(days)
    }

    class NotificationService {
        +push(payload) never_throws
        +list(...)
        +markRead(...)
        +markAllRead(...)
    }

    class TokenService {
        +issueRefreshToken(user, req)
        +rotateRefreshToken(raw, req)
        +revokeRefreshToken(raw)
        +revokeAllForUser(id)
        +issuePasswordResetToken(user, req)
        +consumePasswordResetToken(raw)
        +refreshCookieOptions()
    }

    MedicalRecordController --> MedicalRecordService
    MedicalRecordService --> MedicalRecordRepository
    MedicalRecordService --> EncryptionService
    MedicalRecordService --> IpfsService
    MedicalRecordService --> BlockchainService
    MedicalRecordService --> AccessControlService
    MedicalRecordService --> AuditService
    MedicalRecordService --> NotificationService
    AccessControlService --> AccessPermissionRepository
    AccessControlService --> MedicalRecordRepository
    AccessControlService --> BlockchainService
    IpfsService ..> LocalDriver : selects
    IpfsService ..> PinataDriver : selects
```

## Mongoose models

```mermaid
classDiagram
    direction LR

    class User {
        +String name
        +String email
        -String password
        +String role
        +Object patientProfile
        +Object doctorProfile
        +String walletAddress
        -Boolean isActive
        +comparePassword(candidate) bool
        +changedPasswordAfter(iat) bool
        +toSafeObject()
        +toAdminObject()
    }

    class MedicalRecord {
        +ObjectId patient
        +ObjectId uploadedBy
        +String title
        +String recordType
        +Object file
        +Object storage
        +Object integrity
        -Object encryption
        +Object blockchain
        -Boolean isDeleted
        +toClientObject()
    }

    class AccessPermission {
        +ObjectId record
        +ObjectId patient
        +ObjectId doctor
        +Date expiresAt
        +Date revokedAt
        +Boolean custodial
        +isLive() bool
        +toClientObject()
    }

    class Token {
        +ObjectId user
        +String type
        +String tokenHash
        +Date expiresAt
        +Date usedAt
        +isUsable() bool
        +generate()$ raw_hash
        +hash(raw)$ String
    }

    class AuditLog {
        <<append-only>>
        +String action
        +String category
        +String outcome
        +String actorEmail
        +String actorRole
        +String ipAddress
    }

    User "1" --> "*" MedicalRecord
    User "1" --> "*" AccessPermission
    User "1" --> "*" Token
    User "1" --> "*" AuditLog
    MedicalRecord "1" --> "*" AccessPermission
```

## Smart contract

```mermaid
classDiagram
    class TelemedicineRecords {
        <<Solidity 0.8.24>>
        +bytes32 ADMIN_ROLE
        +bytes32 REGISTRAR_ROLE
        +bytes32 CUSTODIAN_ROLE
        -mapping participants
        -mapping records
        -mapping grants
        -uint256 recordCount

        +registerPatient(addr, profileRef)
        +registerDoctor(addr, profileRef)
        +verifyDoctor(addr)
        +revokeDoctorVerification(addr)
        +anchorRecord(patient, hash, cid, type) uint256
        +deactivateRecord(id)
        +grantAccess(id, doctor, expiresAt)
        +grantAccessFor(id, doctor, expiresAt)
        +revokeAccess(id, doctor)
        +hasAccess(id, viewer) bool
        +logAccess(id, viewer)
        +verifyRecordIntegrity(id, hash) bool
        +pause()
        +unpause()
    }

    class AccessControl {
        <<OpenZeppelin>>
        +hasRole(role, account) bool
        +grantRole(role, account)
        +revokeRole(role, account)
    }

    class Pausable {
        <<OpenZeppelin>>
        -_pause()
        -_unpause()
    }

    class ReentrancyGuard {
        <<OpenZeppelin>>
        <<modifier nonReentrant>>
    }

    TelemedicineRecords --|> AccessControl
    TelemedicineRecords --|> Pausable
    TelemedicineRecords --|> ReentrancyGuard
```

## The rule these diagrams encode

Dependencies point **downward only**: controller → service → repository →
model. A repository never imports a service; a model never imports anything
above it. That is what makes the service layer testable in isolation and the
persistence engine replaceable.

`EncryptionService` is the only module that touches the master key.
`BlockchainService` is the only module that imports ethers. `IpfsService` is the
only module that knows which storage provider is in use. Each of those is a
single, auditable place to review — which is the actual point of the layering.
