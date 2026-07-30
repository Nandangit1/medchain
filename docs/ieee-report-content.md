# IEEE Report Content

Source material for the project report, organised in IEEE section order. Prose is
written to be adapted, not pasted verbatim — reword it in your own voice.

---

## Abstract

Electronic health records are conventionally held in provider-controlled
databases, an arrangement that grants custodians unilateral ability to read,
alter or lose patient data, and leaves patients without any independent means of
verifying the integrity of their own medical history. This paper presents a
telemedicine platform that separates the three concerns of storage,
confidentiality and integrity across purpose-appropriate technologies.

Medical documents are encrypted with AES-256-GCM under a per-file
content-encryption key before leaving the application server; that key is itself
wrapped with a master key, and only the wrapped form is persisted. Ciphertext is
stored on the InterPlanetary File System (IPFS), which addresses content by its
cryptographic digest. A SHA-256 digest of the *plaintext*, together with the IPFS
content identifier, is anchored in an Ethereum smart contract, alongside an
immutable event log of every access grant and revocation. Clinical content is
never written on-chain.

The resulting system allows any party holding a document to verify — independently
of the platform operator — that it is byte-identical to the one anchored at a
given block, while read access remains contingent on an explicit,
patient-authorised grant enforced both off-chain and on-chain. A working
implementation comprising a Node.js/Express REST API, a Solidity contract
deployed via Hardhat, and a React single-page application is validated by 112
automated tests, including adversarial cases for tamper detection, unauthorised
access and transaction-level concurrency.

**Keywords** — telemedicine, blockchain, Ethereum, IPFS, envelope encryption,
AES-256-GCM, access control, data integrity, electronic health records

---

## I. Introduction

### A. Background

Telemedicine adoption accelerated substantially following the COVID-19 pandemic,
shifting a significant share of consultation and diagnostic-report exchange to
digital channels. This shift has not been matched by a corresponding change in
how records are governed: they remain in siloed, provider-controlled databases.

### B. Problem statement

Four deficiencies follow from provider-controlled storage:

1. **Unverifiable integrity.** A patient cannot detect whether a stored report
   has been altered, because the only record of what it originally contained is
   held by the party who might have altered it.
2. **Custodial control.** Administrative access typically implies read access to
   clinical content, whether or not that is operationally necessary.
3. **Opaque disclosure.** Patients generally cannot enumerate who has accessed
   their records, nor withdraw that access with any assurance it took effect.
4. **Fragmentation.** Records are partitioned by provider, so a complete history
   must be reassembled manually by the patient at each new point of care.

### C. Objectives

1. Ensure confidentiality such that neither the storage layer nor a database
   compromise yields readable clinical content.
2. Ensure integrity is verifiable by any party, independently of the operator.
3. Place disclosure under explicit patient authorisation, with immediate and
   auditable revocation.
4. Ensure every consequential action is recorded in a log that the application
   itself cannot rewrite.
5. Demonstrate the above in a working system, not a simulation.

### D. Scope and limitations

The system encrypts server-side rather than end-to-end. The application server
therefore holds the master key and observes plaintext transiently in memory; a
compromise of the server compromises confidentiality. This is a deliberate
trade-off: true end-to-end encryption would require client-held keys, which
introduces key-escrow and client-side key-exchange problems that fall outside the
scope of this work. The design protects against storage compromise, IPFS
exposure and database theft — and this boundary is stated explicitly rather than
elided.

### E. Contributions

1. An envelope-encryption scheme applied to clinical documents, with the
   integrity digest taken over plaintext so that it remains a stable identity for
   the document independent of encryption or storage provider.
2. A dual-enforcement authorisation model in which MongoDB decides and the
   blockchain may veto, with a documented and defended failure mode when the
   chain is unreachable.
3. A pluggable storage abstraction permitting the entire system to be developed
   and demonstrated without third-party credentials.
4. Identification and remediation of three implementation-level defects of
   general interest to blockchain-integrated systems, discussed in Section VII.

---

## II. Literature Survey

Structure the survey around these themes; populate with papers from IEEE Xplore,
ScienceDirect and PubMed from 2019 onward.

| Theme | What to cover | Gap to identify |
| --- | --- | --- |
| Blockchain EHR frameworks | MedRec, Medicalchain, FHIRChain and similar | Most publish architectures without a working, tested implementation |
| On-chain vs off-chain storage | Cost and privacy analyses of storing payloads on-chain | Consensus that payloads must be off-chain; less attention to what integrity anchor to choose |
| IPFS in healthcare | Content addressing, pinning, availability | **IPFS is frequently treated as private storage. It is not — a CID is a capability.** Many designs omit encryption entirely |
| Access control on-chain | ABAC/RBAC via smart contracts | Expiry, revocation latency and behaviour under chain unavailability are rarely addressed |
| Encryption schemes for EHR | Symmetric, attribute-based, proxy re-encryption | ABE offers elegant policy expression but immature tooling and heavy key management |
| Audit and compliance | HIPAA/GDPR alignment, immutable logging | Rarely reconciled with GDPR erasure obligations |

### Comparison table for the report

| Work | Storage | Encryption | Chain role | Revocation | Implementation |
| --- | --- | --- | --- | --- | --- |
| MedRec (2016) | Provider DBs | None specified | Pointer + permissions | Not detailed | Prototype |
| Medicalchain | Off-chain | Symmetric | Access control | Yes | Commercial, closed |
| FHIRChain | Off-chain | Public-key | Identity + tokens | Partial | Prototype |
| **This work** | IPFS | **AES-256-GCM envelope** | **Plaintext hash + CID + event log** | **Immediate, dual-enforced, auditable** | **Full stack, 112 tests** |

### The gap this work addresses

Existing designs converge on off-chain payload storage. Three questions remain
comparatively underexplored, and they are the ones this work answers concretely:

1. Should the integrity anchor digest the plaintext or the ciphertext? (Plaintext
   — Section IV-B.)
2. What should the system do when the blockchain is unreachable during an
   authorisation check? (Fail *open* to the database decision, since the chain can
   only narrow access — Section IV-D.)
3. How is nonce ordering handled when a single service key signs concurrent
   transactions? (Serialised submission with an in-process counter — Section VII.)

---

## III. System Analysis

### A. Existing system

Provider-hosted EHR databases with role-based access enforced solely in
application code, no cryptographic integrity guarantee, and audit logs stored in
the same mutable database as the records they describe.

### B. Proposed system

A layered architecture distributing responsibility across MongoDB (queryable
metadata and wrapped keys), IPFS (encrypted payloads), and Ethereum (integrity
anchors and access events).

### C. Feasibility

- **Technical.** All components are mature and open source. Node 20, Solidity
  0.8.24, React 18.
- **Economic.** Anchoring one record costs a single small transaction; no payload
  storage on-chain. A local driver and Hardhat Network make development
  zero-cost.
- **Operational.** Runs on a single workstation for demonstration; the deployment
  path to Atlas, Pinata and Sepolia is documented.

### D. Requirements

**Functional.** Registration with role selection; administrator verification of
medical licences; encrypted upload; integrity verification; time-limited sharing;
immediate revocation; doctor diagnosis and prescription capture; appointment
scheduling; audit inspection.

**Non-functional.** Confidentiality (AES-256-GCM); integrity (SHA-256, on-chain);
authenticity (JWT + bcrypt cost 12); availability (chain outage must not block
clinical access); auditability (append-only log); usability (responsive,
dark-mode, WCAG-conscious contrast).

**Hardware/software.** Development: 8 GB RAM, Node ≥ 18.18, MongoDB 6+, modern
browser. Deployment: as in `deployment-guide.md`.

---

## IV. System Design

Diagrams are in `docs/diagrams/` as Mermaid — render to PNG/SVG for the report.

- ER model → `er-diagram.md`
- DFD levels 0, 1, 2 → `dfd.md`
- Class/module diagram → `class-diagram.md`
- Sequence diagrams (six flows) → `sequence-diagrams.md`
- Component and deployment → `component-diagram.md`

### A. Architecture

Seven layers: presentation (React) → REST (Express) → controllers → services →
repositories → data (MongoDB) → blockchain (Ethereum) and distributed storage
(IPFS). Dependencies point downward only, which is what confines every
authorisation decision to the service layer.

### B. Cryptographic design

For each record *r*:

```
CEK_r  ← CSPRNG(32 bytes)
IV_r   ← CSPRNG(12 bytes)
C_r    ← AES-256-GCM(CEK_r, IV_r, P_r)      plus 16-byte tag T_r
H_r    ← SHA-256(P_r)                        digest of the PLAINTEXT
W_r    ← AES-256-GCM(K_master, IV'_r, CEK_r) plus tag T'_r

Persisted:  {IV_r, T_r, W_r, IV'_r, T'_r, H_r, CID_r}
On-chain:   {H_r, CID_r, owner, type, timestamp}
Discarded:  CEK_r, P_r
```

Three justifications for the envelope construction:

1. **Key separation** — compromise of one CEK exposes exactly one document.
2. **Nonce safety** — GCM confidentiality collapses if a (key, IV) pair repeats;
   a fresh random CEK per file renders IV collisions across files harmless.
3. **Rotation** — *K<sub>master</sub>* can be rotated by re-wrapping the small
   *W<sub>r</sub>* blobs, with no re-encryption or re-upload of payloads.

Digesting the plaintext, not the ciphertext, is what makes *H<sub>r</sub>* a
stable identity for the document: it is invariant under key rotation, re-pinning
and provider migration, and it is a value the patient can independently
recompute from a copy of the original file.

### C. Smart contract design

Solidity 0.8.24 with OpenZeppelin `AccessControl`, `Pausable` and
`ReentrancyGuard`. Four roles; custom errors rather than revert strings for gas
efficiency and precise testability; an event emitted on every state transition,
which *is* the audit trail.

`hasAccess(recordId, viewer)` fails closed on five conditions: inactive record,
absent grant, expired grant, withdrawn verification, deactivated account. The
owning patient always passes.

Two design choices worth highlighting in the report:

- **`revokeAccess` is exempt from `Pausable`.** Withdrawing consent must never be
  blocked by an operational emergency stop.
- **`CUSTODIAN_ROLE` is separate and revocable.** It permits platform-signed
  grants for patients without wallets; every such grant emits `custodial=true`,
  so the audit trail never conflates it with a patient-signed one.

### D. Authorisation model

| Actor | Metadata | Plaintext | Rationale |
| --- | --- | --- | --- |
| Owning patient | Yes | Yes | Data subject |
| Granted, verified doctor | Yes | Yes | Explicit, revocable, time-limited consent |
| Administrator | Yes | **No** | Operates the platform; has no clinical need |
| Any other party | No | No | — |

Checked twice: MongoDB decides, the chain may veto. When the chain is
unreachable, `hasAccessOnChain` returns `null` and the database decision stands.
This is defended in the report as the correct failure mode: the chain can only
ever *narrow* access, and a distributed-ledger outage denying clinicians access
to patient data would be a worse harm than the marginal risk of honouring a
database decision the chain had not yet contradicted.

---

## V. Implementation

### A. Technology stack

| Layer | Technology | Version |
| --- | --- | --- |
| Frontend | React, React Router, Bootstrap, React Hook Form + Yup, Recharts | 18 / 6 / 5 |
| Backend | Node.js, Express, Mongoose | 20+ / 4 / 8 |
| Security | jsonwebtoken, bcrypt, helmet, express-rate-limit, express-mongo-sanitize, hpp | — |
| Crypto | Node `crypto` (AES-256-GCM, SHA-256, HMAC) | built-in |
| Blockchain | Solidity, Hardhat, ethers, OpenZeppelin | 0.8.24 / 2.29 / 6 / 5 |
| Storage | IPFS via Pinata; local content-addressed driver | — |
| Database | MongoDB | 6+ |
| Logging | Winston with daily rotation | 3 |
| Testing | node:test, Hardhat + Chai | — |

Justify two selections explicitly, since both were points where a plausible
alternative was rejected: **Hardhat over Ganache** (Ganache was sunset by
Truffle in 2023; Hardhat Network provides the same local chain plus Solidity
stack traces), and **React Hook Form over Formik** (fewer re-renders; Formik is
effectively in maintenance mode).

### B. Module breakdown

Eleven modules: backend foundation and authentication; administrator
verification; records with encryption and IPFS; smart contract and anchoring;
sharing and chain history; doctor workflows; appointments; React foundation;
patient, doctor and administrator portals; hardening, documentation and
deployment.

### C. Key algorithms to present as pseudocode

1. Record ingestion (DFD level 2, process 2.0).
2. Authorised retrieval with dual enforcement (process 4.0).
3. Refresh-token rotation with reuse detection.
4. Serialised transaction submission with nonce tracking.

---

## VI. Testing and Results

112 automated tests: 74 API integration, 38 smart contract. Full breakdown in
`docs/testing-guide.md`.

Emphasise that the suites are weighted towards **negative** assertions —
confirming that an unverified doctor cannot be granted access, that a revoked
doctor loses it immediately, that a tampered file is never served, and that a
replayed refresh token revokes the session family.

### Results table for the report

| Property | Test | Result |
| --- | --- | --- |
| Ciphertext at rest | Read stored blob, assert no plaintext marker | Pass |
| Lossless round trip | Byte-comparison after decrypt | Pass |
| Tamper detection | Flip one byte on disk | GCM rejects; download 422 |
| On-chain integrity | `verifyRecordIntegrity` | Pass |
| Unverified doctor refused | Grant attempt | Reverts `DoctorNotVerified` |
| Non-owner cannot grant | Grant attempt by third party | Reverts `NotRecordOwner` |
| Revocation latency | Read immediately after revoke | 403 |
| Autonomous expiry | Advance chain time past expiry | `hasAccess` false |
| Admin cannot read files | Download as admin | 403 |
| Cross-patient isolation | Read another patient's record | 403 |
| Scope cannot be widened | Forged `patientId` filter | Empty result |
| Concurrency safety | 4 simultaneous uploads | 4 distinct on-chain ids |
| Refresh replay | Reuse spent token | Family revoked |
| Reset token single use | Reuse spent token | 400 |
| No user enumeration | Reset for unknown address | Identical response |
| Pause safety | Revoke while paused | Succeeds |

Also report deployment gas (~2,142,214) and per-operation gas from
`REPORT_GAS=true npx hardhat test`.

---

## VII. Discussion — Defects Identified and Resolved

This section carries disproportionate weight with examiners, because it
demonstrates engineering rather than assembly. Three defects, each of general
relevance to blockchain-integrated systems:

**1. Transaction nonce collision under concurrency.** Ethereum orders a sender's
transactions by a strictly incrementing nonce. The ethers library derives that
nonce by querying the node's pending transaction count, so two concurrent
requests constructed transactions bearing the same nonce; the second was rejected
and its record silently marked `failed`. Sequentially awaiting each call is
insufficient, because the node's pending count may lag a freshly mined block.
Resolution: serialise submissions through a promise chain with an in-process
nonce counter, reset from the chain on any failure. A regression test issues four
concurrent uploads and asserts four distinct on-chain identifiers.

**2. Silent loss of failure diagnostics.** The ethers error object embeds the
entire signed transaction, exceeding the length constraint on the audit field.
Mongoose validation failed, and because the logging helper deliberately swallows
its own exceptions — so that a logging failure cannot fail the operation it
describes — failed anchors produced *no diagnostic record anywhere*. This masked
defect 1. Resolution: truncate before persisting. The general lesson is that
fault-tolerant logging must not be able to fail silently on its own inputs.

**3. Role misassignment between deployment and service identity.** The deployment
script granted `ADMIN_ROLE` to the deploying account, while the backend signs as
the registrar. `verifyDoctor` therefore reverted, causing every subsequent access
grant to fail and denying doctors access with no obvious cause. Resolution: grant
the role to the service identity while retaining `DEFAULT_ADMIN_ROLE` on an
offline key that can revoke it.

A fourth, language-level defect is worth a paragraph: express-validator chains
are mutable objects, so sharing a rule instance between two rule sets and calling
`.optional()` on it for one mutated both — silently making a required field
optional. Resolution: expose rules as factories returning fresh chains.

---

## VIII. Conclusion and Future Work

### Conclusion

The system demonstrates that patient-controlled, integrity-verifiable medical
records are achievable with mature, open technologies, and that blockchain is
most usefully applied as a *narrow* integrity and consent-audit layer rather than
as a storage medium. Confining on-chain data to a plaintext digest, a content
identifier and consent events keeps cost bounded and avoids writing clinical
content to an immutable public ledger. Encoding the administrator's inability to
read clinical files as a code-level constraint converts patient data ownership
from a policy claim into a system property.

### Future work

1. **End-to-end encryption** with client-held keys, addressing key escrow via
   threshold recovery or hardware-backed key storage.
2. **Proxy re-encryption or attribute-based encryption** so that sharing does not
   require the server to hold the content key.
3. **Layer-2 deployment** (Polygon, Arbitrum) to reduce anchoring cost, with
   periodic batched commitment to Ethereum mainnet.
4. **GDPR erasure reconciliation.** On-chain data cannot be deleted; the current
   design relies on erasing the decryption key so ciphertext becomes permanently
   opaque ("crypto-shredding"). Whether that satisfies Article 17 is unsettled and
   deserves a section of its own.
5. **HL7 FHIR conformance** for interoperability with existing hospital systems.
6. **Horizontal scaling** of the anchoring path via a single-consumer queue,
   removing the in-process nonce constraint.
7. **Zero-knowledge proofs** allowing a patient to prove a property of a record
   (for example, a vaccination status) without disclosing the document.
8. **Formal verification** of the access-control contract using Certora or the
   Solidity SMT checker.

---

## References — starting points

Cite from IEEE Xplore, ACM DL, ScienceDirect and PubMed. Anchor at minimum:

1. Azaria, Ekblaw, Vieira, Lippman, "MedRec: Using Blockchain for Medical Data
   Access and Permission Management," *OBD*, 2016.
2. Zhang, White, Schmidt, Lenz, Rosenbloom, "FHIRChain: Applying Blockchain to
   Securely and Scalably Share Clinical Data," *CSBJ*, 2018.
3. Benet, "IPFS — Content Addressed, Versioned, P2P File System," arXiv, 2014.
4. Wood, "Ethereum: A Secure Decentralised Generalised Transaction Ledger"
   (Yellow Paper).
5. Dworkin, "Recommendation for Block Cipher Modes of Operation: Galois/Counter
   Mode (GCM) and GMAC," NIST SP 800-38D, 2007.
6. NIST FIPS 180-4, "Secure Hash Standard."
7. Provos and Mazières, "A Future-Adaptable Password Scheme," USENIX, 1999.
8. Jones, Bradley, Sakimura, "JSON Web Token (JWT)," RFC 7519, 2015.
9. Nakamoto, "Bitcoin: A Peer-to-Peer Electronic Cash System," 2008.
10. Recent (2022–2025) surveys of blockchain in healthcare, to establish currency.

Cite NIST SP 800-38D for the 96-bit IV recommendation and FIPS 180-4 for
SHA-256 — grounding specific parameter choices in standards rather than
convention materially strengthens the design section.

---

## Appendices

- **A.** Complete API reference — `docs/api/medical-records.md`, plus the endpoint
  inventory in `README.md`.
- **B.** Smart contract source — `blockchain/contracts/TelemedicineRecords.sol`.
- **C.** Database schema — `docs/diagrams/er-diagram.md`.
- **D.** Test output — paste the full run of both suites.
- **E.** Screenshots — `docs/screenshots/`.
- **F.** Installation and deployment guides.
- **G.** Viva question bank — `docs/viva-questions.md`.
