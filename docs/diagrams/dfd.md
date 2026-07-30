# Data Flow Diagrams

## Level 0 — Context diagram

```mermaid
flowchart LR
    PATIENT([Patient])
    DOCTOR([Doctor])
    ADMIN([Administrator])

    SYSTEM["`**0**
    Blockchain-Based Secure
    Telemedicine System`"]

    IPFS[("IPFS / Pinata
    encrypted files")]
    CHAIN[("Ethereum
    hashes + access events")]
    DB[("MongoDB
    metadata + wrapped keys")]

    PATIENT -->|"credentials, reports, share/revoke decisions"| SYSTEM
    SYSTEM -->|"records, integrity proofs, chain history"| PATIENT

    DOCTOR -->|"credentials, diagnoses, prescriptions"| SYSTEM
    SYSTEM -->|"shared records, patient list"| DOCTOR

    ADMIN -->|"verification decisions, user actions"| SYSTEM
    SYSTEM -->|"analytics, audit log, chain status"| ADMIN

    SYSTEM <-->|"ciphertext / CID"| IPFS
    SYSTEM <-->|"hash + CID, grant events"| CHAIN
    SYSTEM <-->|"documents"| DB
```

## Level 1 — Major processes

```mermaid
flowchart TB
    PATIENT([Patient])
    DOCTOR([Doctor])
    ADMIN([Administrator])

    subgraph SYS["Telemedicine System"]
        P1["`**1.0**
        Authentication
        & session management`"]
        P2["`**2.0**
        Record ingestion
        encrypt → pin → anchor`"]
        P3["`**3.0**
        Access control
        grant / revoke`"]
        P4["`**4.0**
        Record retrieval
        fetch → decrypt → verify`"]
        P5["`**5.0**
        Clinical workflow
        diagnosis / prescription`"]
        P6["`**6.0**
        Administration
        verification / analytics`"]
        P7["`**7.0**
        Audit &
        notification`"]
    end

    D1[("D1 Users")]
    D2[("D2 Medical records")]
    D3[("D3 Access permissions")]
    D4[("D4 Audit log")]
    D5[("D5 Tokens")]
    D6[("D6 Blockchain tx log")]
    IPFS[("IPFS")]
    CHAIN[("Ethereum")]

    PATIENT --> P1
    DOCTOR --> P1
    ADMIN --> P1
    P1 <--> D1
    P1 <--> D5
    P1 --> P7

    PATIENT -->|"file + metadata"| P2
    P2 --> D2
    P2 -->|ciphertext| IPFS
    P2 -->|"hash + CID"| CHAIN
    P2 --> D6
    P2 --> P7

    PATIENT -->|"share / revoke"| P3
    P3 <--> D3
    P3 -->|"grant event"| CHAIN
    P3 --> D6
    P3 --> P7

    PATIENT --> P4
    DOCTOR --> P4
    P4 -->|"authorisation check"| D3
    P4 -->|"hasAccess()"| CHAIN
    P4 -->|"fetch by CID"| IPFS
    P4 <--> D2
    P4 -->|plaintext| PATIENT
    P4 -->|plaintext| DOCTOR
    P4 --> P7

    DOCTOR --> P5
    P5 <--> D2
    P5 --> D3
    P5 --> P7

    ADMIN --> P6
    P6 <--> D1
    P6 --> D4
    P6 --> D6
    P6 -->|"verifyDoctor()"| CHAIN

    P7 --> D4
```

## Level 2 — Process 2.0, record ingestion

The process that carries the project's core claim, expanded.

```mermaid
flowchart TB
    IN["Multipart request
    file + title + type"]

    V1["2.1 Validate
    MIME allow-list, size cap"]
    V2["2.2 Buffer in memory
    plaintext never written to disk"]
    V3["2.3 Digest
    sha256(plaintext)"]
    V4{"2.4 Duplicate?
    same hash for this patient"}
    V5["2.5 Encrypt
    AES-256-GCM, random CEK"]
    V6["2.6 Wrap CEK
    with FILE_ENCRYPTION_KEY"]
    V7["2.7 Pin ciphertext"]
    V8["2.8 Persist metadata
    + envelope"]
    V9{"2.9 DB write ok?"}
    V10["2.10 Compensate
    unpin orphaned CID"]
    V11["2.11 Anchor on-chain"]
    V12{"2.12 Chain ok?"}
    V13["status = confirmed
    + onChainId, txHash"]
    V14["status = failed
    retryable via backfill"]
    OUT["201 Created"]

    IPFS[("IPFS")]
    DB[("D2 Medical records")]
    CHAIN[("Ethereum")]

    IN --> V1 --> V2 --> V3 --> V4
    V4 -->|yes| REJ["409 Conflict"]
    V4 -->|no| V5 --> V6 --> V7
    V7 --> IPFS
    V7 --> V8 --> DB
    V8 --> V9
    V9 -->|no| V10 --> ERR["500 — nothing orphaned"]
    V9 -->|yes| V11 --> CHAIN
    V11 --> V12
    V12 -->|yes| V13 --> OUT
    V12 -->|no| V14 --> OUT
```

**Why 2.10 exists.** The pin succeeds before the database write. Without a
compensating unpin, a failed metadata write would leave an encrypted blob on
IPFS that nothing in the system can ever reference or clean up.

**Why 2.12 does not fail the request.** By that point the file is encrypted,
pinned and persisted. A chain outage leaves `blockchain.status: "pending"` and
`npm run backfill:anchors` re-drives it — losing an upload because a node was
briefly unreachable would be the wrong trade.

## Level 2 — Process 4.0, retrieval with authorisation

```mermaid
flowchart TB
    REQ["GET /records/:id/download"]
    A1{"4.1 Authenticated?"}
    A2{"4.2 Owner?"}
    A3{"4.3 Admin?"}
    A4{"4.4 Doctor
    verified?"}
    A5{"4.5 Live grant
    in MongoDB?"}
    A6{"4.6 Chain says
    hasAccess?"}
    F1["4.7 Fetch ciphertext by CID"]
    F2["4.8 Unwrap CEK, decrypt"]
    F3{"4.9 sha256 matches
    stored hash?"}
    F4["4.10 Stream plaintext
    no-store headers"]
    F5["4.11 Log access on-chain
    + notify patient"]

    REQ --> A1
    A1 -->|no| E401["401"]
    A1 -->|yes| A2
    A2 -->|yes| F1
    A2 -->|no| A3
    A3 -->|yes| E403A["403 — admins never read clinical files"]
    A3 -->|no| A4
    A4 -->|no| E403B["403"]
    A4 -->|yes| A5
    A5 -->|no| E403C["403"]
    A5 -->|yes| A6
    A6 -->|"false (explicit veto)"| E403D["403"]
    A6 -->|"true or unreachable"| F1
    F1 --> F2 --> F3
    F3 -->|no| E422["422 — tamper detected, download blocked"]
    F3 -->|yes| F4 --> F5
```

**Why 4.6 admits an unreachable chain.** Authorisation is checked twice:
MongoDB decides, and the chain may *veto*. If the node cannot be reached the
database decision stands — a blockchain outage locking clinicians out of patient
data is the wrong failure mode for a medical system. The chain can only ever
narrow access, never widen it.

**Why 4.9 exists on top of GCM.** The authentication tag already proves the
ciphertext was not modified. This second check also catches a storage layer that
silently returned the *wrong object*, and it is the same comparison the contract
performs against the on-chain hash.
