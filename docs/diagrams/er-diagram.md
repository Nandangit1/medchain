# Entity Relationship Diagram

MongoDB is document-oriented, so this is a *logical* ER model: "foreign keys"
are `ObjectId` references resolved by Mongoose `populate`, not database-enforced
constraints.

```mermaid
erDiagram
    USER ||--o{ MEDICAL_RECORD : "owns (patient)"
    USER ||--o{ MEDICAL_RECORD : "uploaded (uploadedBy)"
    USER ||--o{ ACCESS_PERMISSION : "grants (patient)"
    USER ||--o{ ACCESS_PERMISSION : "receives (doctor)"
    USER ||--o{ DIAGNOSIS : "authors (doctor)"
    USER ||--o{ APPOINTMENT : "books (patient)"
    USER ||--o{ APPOINTMENT : "attends (doctor)"
    USER ||--o{ NOTIFICATION : receives
    USER ||--o{ AUDIT_LOG : "acts in"
    USER ||--o{ TOKEN : holds
    USER ||--o{ BLOCKCHAIN_TX : "initiates"

    MEDICAL_RECORD ||--o{ ACCESS_PERMISSION : "is shared by"
    MEDICAL_RECORD ||--o{ DIAGNOSIS : "is assessed by"
    MEDICAL_RECORD ||--o{ BLOCKCHAIN_TX : "is anchored by"
    MEDICAL_RECORD ||--o| MEDICAL_RECORD : "prescription for"

    USER {
        ObjectId _id PK
        String name
        String email UK "unique, lowercase"
        String password "bcrypt cost 12, select false"
        String role "patient | doctor | admin"
        String phone
        String gender
        Date dateOfBirth
        Object address "embedded"
        Object patientProfile "bloodGroup, emergency contact"
        Object doctorProfile "specialization, licence UK, verificationStatus"
        String walletAddress UK "sparse"
        String walletType "custodial | external"
        Boolean isActive "select false"
        Date passwordChangedAt
        Date lastLoginAt
        Date createdAt
    }

    MEDICAL_RECORD {
        ObjectId _id PK
        ObjectId patient FK
        ObjectId uploadedBy FK
        String uploadedByRole
        String title
        String description
        String recordType "lab_report | prescription | ..."
        Date recordDate
        Array tags
        Object file "originalName, mimeType, extension, size"
        Object storage "provider, cid, gatewayUrl, encryptedSize"
        Object integrity "algorithm, fileHash = sha256(PLAINTEXT)"
        Object encryption "iv, authTag, wrappedKey — SELECT FALSE"
        Object blockchain "status, onChainId, txHash, blockNumber"
        String status "active | archived"
        Boolean isDeleted "soft delete, select false"
    }

    ACCESS_PERMISSION {
        ObjectId _id PK
        ObjectId record FK
        ObjectId patient FK
        ObjectId doctor FK
        Date grantedAt
        Date expiresAt "null = never expires"
        Date revokedAt "null = live"
        Boolean custodial "true = platform signed"
        Object grantTx "status, txHash, blockNumber"
        Object revokeTx "status, txHash, blockNumber"
    }

    DIAGNOSIS {
        ObjectId _id PK
        ObjectId record FK
        ObjectId patient FK
        ObjectId doctor FK
        String summary
        String details
        String icdCode "ICD-10"
        String severity "low | moderate | high | critical"
        Date followUpAt
        ObjectId prescriptionRecord FK
    }

    APPOINTMENT {
        ObjectId _id PK
        ObjectId patient FK
        ObjectId doctor FK
        Date scheduledFor
        Number durationMinutes
        String mode "video | in_person | phone"
        String status "requested | confirmed | completed | cancelled | no_show"
        String reason
        String doctorNotes
        String cancellationReason
    }

    BLOCKCHAIN_TX {
        ObjectId _id PK
        String type "anchor_record | grant_access | ..."
        String status "pending | confirmed | failed"
        String txHash
        Number blockNumber
        String gasUsed
        String onChainId
        ObjectId relatedUser FK
        ObjectId relatedRecord FK
        String contractAddress
        Number chainId
        String error
    }

    AUDIT_LOG {
        ObjectId _id PK
        String action
        String category
        String outcome "success | failure"
        ObjectId actor FK
        String actorEmail "as at the time"
        String actorRole "as at the time"
        ObjectId targetUser FK
        ObjectId targetRecord FK
        String description
        Mixed metadata
        String ipAddress
        Date createdAt "no updatedAt — append only"
    }

    NOTIFICATION {
        ObjectId _id PK
        ObjectId user FK
        String type
        String title
        String message
        String link "frontend route"
        Date readAt "null = unread"
        Date createdAt "TTL 90 days"
    }

    TOKEN {
        ObjectId _id PK
        ObjectId user FK
        String type "refresh | password_reset"
        String tokenHash "sha256 — raw value never stored"
        Date expiresAt "TTL index"
        Date usedAt
        Date revokedAt
        String replacedBy "rotation chain"
    }
```

## Design decisions worth defending

**One `USER` collection, not three.** Patients, doctors and admins share
identity, authentication and contact fields. Splitting them would duplicate all
of that and make "find the user with this email" a three-collection query. Role
is a discriminator; role-specific fields live in `patientProfile` /
`doctorProfile` subdocuments, and Mongoose applies conditional `required`
validators so a doctor cannot be created without a licence number.

**`encryption` is `select: false`.** Key material is excluded from every query
by default and must be explicitly requested by the two code paths that need it
(download and integrity verification). A forgotten projection therefore cannot
leak it.

**`integrity.fileHash` is the digest of the plaintext, not the ciphertext.** It
stays a stable identity for the *document* regardless of how it was encrypted or
which provider stored it — which is why it is the value anchored on-chain.

**Soft delete, never hard delete.** `isDeleted` is excluded at the repository
boundary so no caller can leak a deleted record by forgetting a filter. The row
and its on-chain anchor survive; only the encrypted blob is unpinned.

**Partial unique index on `ACCESS_PERMISSION`.** `{ record, doctor }` is unique
only where `revokedAt: null`, so at most one *live* grant exists per pair while
every historical revocation is retained.

**Only token hashes are stored.** A stolen database yields no usable refresh or
reset token. SHA-256 rather than bcrypt is correct because these are 32 bytes of
CSPRNG output — there is no low-entropy guess for a slow hash to defend against.
