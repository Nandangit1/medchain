# Viva Question Bank

Answers reference the actual implementation. Where a design has a genuine
weakness, that is stated — examiners respect a candidate who knows the limits of
their own system far more than one who claims there are none.

---

## A. Core concept

**Q1. Why not store medical records on the blockchain itself?**

Three reasons, in order of severity. First, privacy: blockchain data is
permanent and world-readable, so a clinical document written on-chain can never
be withdrawn — it would be the worst possible place for it. Second, cost: on
Ethereum, storage costs roughly 20,000 gas per 32-byte word, making even a small
PDF economically absurd. Third, there is no need — a 32-byte hash is sufficient
to prove a document has not changed.

So the split is: bytes on IPFS, fingerprint on-chain, searchable metadata in
MongoDB.

**Q2. What exactly is on-chain?**

The SHA-256 of the plaintext, the IPFS CID of the ciphertext, the owner and
uploader addresses, a numeric record type, timestamps, and every access grant
and revocation as events. No names, no emails, no diagnoses, no filenames.

**Q3. How does a patient prove a record was not altered?**

`GET /records/:id/verify` re-fetches from IPFS, decrypts, recomputes SHA-256 and
compares it to both the stored hash and the on-chain hash via
`verifyRecordIntegrity`. The on-chain check is independent of MongoDB, so a
tampered database cannot vouch for itself.

**Q4. Why hash the plaintext rather than the ciphertext?**

The hash then identifies the *document*, independent of how it happened to be
encrypted or which provider stored it. If the encryption key were rotated or the
file re-pinned, a ciphertext hash would change while the document had not. It
also means a patient holding the original PDF can verify it themselves.

---

## B. Cryptography

**Q5. Why AES-256-GCM and not CBC?**

GCM is authenticated encryption: it provides confidentiality *and* integrity via
an authentication tag. CBC provides only confidentiality and is vulnerable to
padding-oracle attacks unless separately MAC'd. With GCM, modifying a single
byte of stored ciphertext makes decryption fail outright — which the tamper test
demonstrates.

**Q6. Explain envelope encryption and why you used it.**

Each file gets a random 32-byte content-encryption key (CEK). The file is
encrypted with the CEK; the CEK is then encrypted ("wrapped") with a server
master key and only the wrapped form is stored.

Three benefits: (1) key separation — compromising one file's key exposes exactly
one file; (2) nonce safety — GCM catastrophically loses confidentiality if a
(key, IV) pair repeats, and a fresh random CEK per file makes an IV collision
across files harmless; (3) rotation — the master key can be rotated by
re-wrapping small key blobs, without re-encrypting or re-uploading any file.

**Q7. Where is the master key, and what happens if it is lost?**

`FILE_ENCRYPTION_KEY` in the environment, 32 bytes as 64 hex characters,
validated at boot. If it is lost, every stored record is permanently
unreadable — there is no recovery path by design. In production it belongs in a
managed secret store, not a `.env` file. **This is a real operational risk of the
design and the mitigation is backup discipline.**

**Q8. Why a 12-byte IV?**

96 bits is what NIST SP 800-38D recommends for GCM. It is the size the
underlying GHASH construction handles without an extra hashing step, and larger
IVs give no security benefit.

**Q9. Why SHA-256 for tokens but bcrypt for passwords?**

Passwords are low-entropy human input, so a deliberately slow hash (bcrypt,
cost 12) makes brute-forcing expensive. Refresh and reset tokens are 32 bytes of
CSPRNG output — there is nothing to guess, so a slow hash buys no security and
would only add latency to a hot path.

**Q10. Is the encryption end-to-end?**

**No, and it is important to be precise about this.** Encryption happens
server-side, so the server sees plaintext transiently in memory. True end-to-end
encryption would require the browser to hold the key, which then raises key
escrow: a patient who loses their key would lose their records permanently, and
sharing with a doctor would require client-side key exchange. The design chosen
protects against storage compromise, IPFS exposure, and database theft — not
against a compromised server. That is a deliberate, documented trade-off.

---

## C. Smart contract

**Q11. Walk through your contract's access control.**

Four roles via OpenZeppelin `AccessControl`: `DEFAULT_ADMIN_ROLE` (can grant and
revoke roles), `ADMIN_ROLE` (verifies doctors, pauses), `REGISTRAR_ROLE` (the
backend service key — registers participants, anchors records, logs access), and
`CUSTODIAN_ROLE` (grants on a patient's behalf).

`hasAccess(recordId, viewer)` is the authorisation oracle. It fails closed on
five separate conditions: inactive record, no grant, expired grant, doctor's
verification withdrawn, doctor deactivated. The owning patient always passes.

**Q12. Why is `CUSTODIAN_ROLE` separate from `REGISTRAR_ROLE`?**

Because it is the one capability that weakens the "patient owns their data"
claim. The intended flow is a patient signing `grantAccess` with their own
wallet. `grantAccessFor` exists only so the platform is usable for patients with
no wallet, every custodial grant emits `custodial=true` so the audit trail
distinguishes them, and because it is a separate role it can be revoked in
production with one transaction.

**Q13. Why custom errors instead of `require` strings?**

Gas and testability. A revert string is stored as string data in the bytecode;
a custom error is a 4-byte selector. They are also precisely assertable —
`revertedWithCustomError(contract, "DoctorNotVerified")` cannot pass by accident
the way a substring match on a message can.

**Q14. Why does `revokeAccess` still work while the contract is paused?**

Because `Pausable` exists for operational emergencies, and withdrawing consent
is not an operation that should ever be blocked by one. If a bug forced a pause,
a patient must still be able to cut off access. `anchorRecord` and `grantAccess`
are paused; `revokeAccess` deliberately is not.

**Q15. Where is reentrancy actually a risk here?**

Honestly, minimally — the contract holds no ether and makes no external calls,
so there is no classic reentrancy vector. `ReentrancyGuard` is applied to
`anchorRecord` as defence-in-depth against future modification. Claiming it
prevents a live exploit would be overstating it.

**Q16. What stops someone anchoring a fake record?**

`anchorRecord` is `onlyRole(REGISTRAR_ROLE)`, so only the backend can call it,
and it verifies the patient is registered, active and actually a patient. If the
registrar key were stolen, the attacker could anchor arbitrary hashes — which is
why that key must live in a secret manager and why `DEFAULT_ADMIN_ROLE` (kept
offline) can revoke it.

**Q17. What is `profileRef`?**

`keccak256(mongoUserId)`. It links an on-chain wallet to an off-chain account
without publishing the identifier itself. The backend can verify the mapping;
an observer cannot reverse it to a database key.

---

## D. Architecture

**Q18. Explain your layering and why it matters.**

`routes → validators → controller → service → repository → model`. Dependencies
point downward only. Controllers are pure HTTP adapters with no business rules;
services own every authorisation decision; repositories hide all Mongoose
syntax.

The concrete payoff: every authorisation rule for clinical data lives in
`medicalRecordService` and `accessControlService`, so reviewing "who can read a
record" means reading two files, not grepping the whole codebase. Soft-delete
filtering lives at the repository boundary, so no caller can leak a deleted
record by forgetting a filter.

**Q19. Which design patterns did you use, and where does each earn its place?**

- **Repository** — `medicalRecordRepository` etc. Makes the service layer
  mockable and the persistence engine replaceable.
- **Service layer** — business logic out of controllers.
- **Factory** — `services/ipfs/index.js` picks `local` or `pinata` from one env
  variable. This one genuinely pays for itself: the whole project is demoable
  offline, and switching to real IPFS is a config change with no code edit.
- **Middleware chain** — `protect → authorize → validate`.
- **Strategy** — the two IPFS drivers behind one contract.

**Q20. Where is the layering not yet clean?**

`authController` and `adminController` from Modules 1–2 still call Mongoose
directly rather than going through repositories. The repository layer arrived in
Module 3 and those two were never migrated. It is inconsistent, and it is
recorded as outstanding work rather than hidden.

**Q21. Why one `User` collection instead of separate Patient/Doctor tables?**

They share identity, authentication and contact fields. Splitting them would
duplicate all of that and make "find the user with this email" a
three-collection query. Role is a discriminator; role-specific data lives in
`patientProfile`/`doctorProfile` subdocuments with conditional `required`
validators, so a doctor cannot be created without a licence number.

---

## E. Security

**Q22. How is authorisation enforced for a doctor reading a record?**

Twice. `accessControlService.doctorCanRead` first checks MongoDB for a live
permission; then it asks the contract's `hasAccess`. A doctor is admitted only
if the database says yes and the chain does not say no.

**Q23. What if the blockchain is unreachable during that check?**

`hasAccessOnChain` returns `null` and the database decision stands. That is a
deliberate choice: a chain outage locking clinicians out of patient data is the
wrong failure mode for a medical system. The chain can only ever *narrow* access,
never widen it — if it has recorded a revocation the database missed, access is
refused.

**Q24. Why can an admin not download a patient's file?**

Because an operator needs to run the platform, not read pathology reports.
`assertCanReadContent` explicitly rejects admins with a distinct message, while
still allowing them metadata and integrity verification. It turns "the patient
owns their data" into a property of the code rather than a claim in a report.

**Q25. Explain the refresh-token design.**

Access token: short-lived JWT, Bearer header, held in memory (mirrored to
localStorage for page refreshes). Refresh token: 32 random bytes in an httpOnly,
`SameSite=Strict` cookie that JavaScript cannot read; only its SHA-256 is stored.

Every refresh rotates the token. Presenting an already-spent token means it
leaked, so the entire family is revoked. The frontend therefore uses a
**single-flight** refresh — N concurrent 401s share one refresh promise, because
firing N parallel refreshes would trip the reuse detector and log the user out.

**Q26. Why does `SameSite=Strict` matter?**

It is what reduces the CSRF surface on `/auth/refresh` to essentially nil: the
browser will not attach the cookie to a cross-site request at all, so an
attacker's page cannot silently mint access tokens.

**Q27. How do you prevent user enumeration?**

`POST /auth/forgot-password` returns an identical response whether or not the
address exists, and failed sign-ins return a generic "Invalid email or password"
rather than distinguishing the two cases. The audit log records the attempted
address for defenders without exposing it to the caller.

**Q28. What injection protections are in place?**

`express-mongo-sanitize` strips `$`-prefixed keys; `hpp` blocks parameter
pollution; every route has express-validator rules. One subtlety worth
mentioning: the global sanitizer runs *before* Multer, when a multipart
`req.body` is still empty — so the upload middleware re-applies it after parsing.
That gap was found and closed during development.

**Q29. How does the MIME allow-list work, and is it sufficient?**

`ALLOWED_MIME_TYPES` is an allow-list, so an arbitrary executable can never
reach storage. It is *not* sufficient on its own: `file.mimetype` comes from the
client's `Content-Type` header and can be spoofed. Magic-byte sniffing would be
the stronger check. The mitigating factor is that files are encrypted, never
executed, and served with `X-Content-Type-Options: nosniff`.

**Q30. What does the audit log guarantee?**

It is append-only: no update or delete route exists anywhere in the codebase.
Actor role, email and IP are captured *as they were at the time*, so a later role
change cannot rewrite history. Writes never throw — losing a log entry is
strictly better than failing the operation it describes.

---

## F. Implementation depth

**Q31. Tell me about a bug you found and fixed.**

Three, all real:

1. **Nonce collision.** One registrar key signs every transaction, and Ethereum
   orders a sender's transactions by strictly incrementing nonce. ethers derives
   the nonce by asking the node for the pending count, so two overlapping
   requests built transactions with the *same* nonce and the second was rejected,
   silently marking records `failed`. Awaiting each call is not enough because
   the node's pending count can lag a freshly mined block. Fixed by serialising
   submissions behind a promise chain with an in-process nonce counter, plus a
   regression test that uploads four records concurrently and asserts four
   distinct on-chain ids.

2. **Failure logs silently dropped.** ethers embeds the entire signed transaction
   in its error messages — thousands of characters — and I wrote that into a
   field capped at 1000. Mongoose validation failed, and the logger's own
   try/catch swallowed it, so failed anchors left *no trace anywhere*. That is
   why bug 1 was invisible at first. Errors are now truncated before logging.

3. **`ADMIN_ROLE` mismatch.** The deploy script granted `ADMIN_ROLE` only to the
   deployer, but the backend signs as the *registrar*, so `verifyDoctor` reverted
   and every on-chain grant failed — doctors were silently denied access. The
   registrar now holds it too, while `DEFAULT_ADMIN_ROLE` stays with the deployer
   so it can revoke.

**Q32. There is also a subtle JavaScript bug you hit in validators — what was it?**

express-validator chains are **mutable**. I shared one `titleRule` between the
create and update rule sets, then called `.optional()` on it for updates — which
mutated the shared instance and made `title` optional on *upload* too. Fixed by
making every rule a factory that returns a fresh chain.

**Q33. What happens if the database write fails after the file is pinned?**

A compensating action unpins the CID. Without it, a failed upload would leave an
encrypted blob on IPFS that nothing in the system could ever reference or clean
up.

**Q34. Why does anchoring happen after persistence rather than before?**

So a chain problem can never lose an upload. By the time `anchorRecord` runs the
file is encrypted, pinned and saved. The function never throws; a failure leaves
`blockchain.status` at `pending` or `failed`, and `npm run backfill:anchors`
re-drives it. That is also why every record is stamped `pending` from Module 3 —
enabling the chain later needed no data migration.

**Q35. How do you prevent double-booking an appointment?**

A partial unique index on `{ doctor, scheduledFor }` restricted to statuses
`requested` and `confirmed`, so cancelled and completed slots free the time. The
duplicate-key error is translated into a 409 rather than a 500.

**Q36. Why is `encryption` marked `select: false`?**

Key material is then excluded from every query by default and must be explicitly
requested by the two paths that need it. A forgotten projection cannot leak it,
and `toClientObject()` strips it as a second layer.

---

## G. Scale and limits

**Q37. What breaks if you run two backend instances?**

The nonce counter is *in-process*, so two instances sharing one registrar key
would collide. Fix: a separate key per instance, or move anchoring to a
single-consumer queue. Similarly, `express-rate-limit` uses in-memory counters,
so limits would be per-process until backed by Redis.

**Q38. Your local IPFS driver generates CIDs — are they real?**

They are well-formed CIDv1 identifiers using the raw codec and SHA-256, and they
are self-verifying. But a real IPFS node chunks payloads above 256 KiB into a
UnixFS DAG whose root CID differs, so for large files my identifier is not what
Kubo would produce. That is documented in `utils/cid.js`, and the Pinata driver
always returns the authoritative CID from the network.

**Q39. How would you scale record retrieval?**

Today every download streams through the API to decrypt. Options: cache
decrypted content briefly in memory for repeat reads within a session; or issue
short-lived pre-signed URLs from a gateway — but that would require moving
decryption to the edge, which reintroduces key-distribution problems. The
current design trades throughput for a single controlled decryption point.

**Q40. What is the biggest weakness of your system?**

The server is trusted. It holds the master key and sees plaintext in memory, so a
compromised backend compromises confidentiality. Second is key custody: losing
`FILE_ENCRYPTION_KEY` destroys all data irrecoverably. Third, the custodial
wallet model means most grants are platform-signed rather than patient-signed,
which weakens the decentralisation claim — mitigated by making that path a
separately revocable role and flagging every custodial grant on-chain.

---

## H. Rapid fire

| Question | Answer |
| --- | --- |
| bcrypt cost factor? | 12 |
| JWT lifetime? | 1 day (`JWT_EXPIRES_IN`) |
| Refresh token lifetime? | 7 days, rotated on each use |
| Password reset window? | 30 minutes, single use |
| Max upload size? | 10 MB (`MAX_UPLOAD_SIZE_MB`) |
| Global rate limit? | 200 requests / 15 min |
| Credential endpoint limit? | 10 / 15 min, successes exempt |
| Solidity version? | 0.8.24, optimizer 200 runs, evmVersion paris |
| Why `paris`? | Avoids PUSH0, which some clients still reject |
| Local chain ID? | 31337 |
| Contract deployment gas? | ~2,142,214 |
| Test counts? | 74 API + 38 contract = 112 |
| Notification retention? | 90 days (TTL index) |
| Why does the audit log have no `updatedAt`? | It is append-only |
| Frontend form library? | React Hook Form + Yup |
| Why not Formik? | Effectively in maintenance mode; RHF has fewer re-renders |
| Why not Ganache? | Sunset by Truffle in 2023; Hardhat Network supersedes it |
| Why is Vite on port 3000? | Must match the backend `CORS_ORIGIN` |
