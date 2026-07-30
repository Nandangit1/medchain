# Testing Guide

**112 automated tests: 74 API integration + 38 smart contract.**

## Philosophy

The suites are weighted towards **negative** assertions. Confirming that a
patient can read their own record proves little; confirming that an unverified
doctor *cannot*, that a revoked doctor loses access *immediately*, and that a
tampered file is *never served* is what actually validates the design.

## Running

Both suites need their dependencies running.

```bash
# Terminal 1: MongoDB
mongod --dbpath .local/mongodb/data

# Terminal 2: local chain
cd blockchain && npx hardhat node

# Terminal 3: deploy, then API
cd blockchain && npx hardhat run scripts/deploy.js --network localhost
cd backend && npm run seed:admin && npm run dev

# Terminal 4: tests
cd backend && npm run test:integration
cd blockchain && npx hardhat test
```

Contract tests need **no** running services — Hardhat spins up its own chain.

```bash
cd blockchain
npx hardhat test
npx hardhat test --grep "Access grants"     # one describe block
REPORT_GAS=true npx hardhat test            # with gas costs
```

API tests drive the running server over HTTP, exactly as the browser does.

```bash
cd backend
npm run test:integration
node -r dotenv/config --test "tests/sharing.integration.test.js"
```

Each run generates a random `runId` and uses it in every email address, so the
suite is re-runnable without wiping the database.

## API coverage — 74 tests

### `medicalRecords.integration.test.js` — 17

| Test | What it proves |
| --- | --- |
| rejects an unauthenticated upload | `protect` is applied |
| rejects a disallowed file type | MIME allow-list blocks `.exe` → 415 |
| rejects missing metadata | validators run after Multer |
| uploads, encrypts and pins | full pipeline; hash is of the **plaintext** |
| **stores ciphertext, not plaintext, at rest** | reads the blob off disk, asserts no `%PDF` |
| rejects a byte-identical duplicate | per-patient hash uniqueness → 409 |
| lists only the owner's records | patient scoping |
| **forged `patientId` filter is ignored** | scope cannot be widened by a query param |
| byte-identical round trip | encrypt → IPFS → decrypt is lossless |
| denies a different patient | cross-tenant isolation → 403 |
| **admin reads metadata but not the file** | administrators never see clinical content |
| verifies integrity of an untampered record | digest comparison |
| confirms the hash against the blockchain | independent on-chain check |
| **concurrent uploads without a nonce collision** | regression: 4 parallel uploads, distinct on-chain ids |
| updates only mutable metadata | CID and hash immutable |
| **detects tampering** | flips a byte on disk → GCM rejects, download 422 |
| soft delete hides the record | 404 afterwards, audit trail intact |

### `sharing.integration.test.js` — 30

Access denial before sharing · **unverified doctor refused** · **non-owner
cannot share** · past expiry rejected · grant succeeds · duplicate grant 409 ·
granted doctor reads metadata and file · doctor's scoped list · patient appears
in doctor's list · other doctors still denied · diagnosis creation · ICD-10
validation · unverified doctor blocked from every doctor route · prescription
upload into a patient chart · **prescription refused for a patient who shared
nothing** · **revocation locks the doctor out immediately** · revoking a
non-existent grant 404 · **revoked grant stays in history** · on-chain history
contains anchor + grant + revoke · patient dashboard aggregates.

Appointments (9): request · **unverified doctor refused** · past time refused ·
**double-booking prevented** · **illegal status transition refused** · patient
cannot confirm their own · confirm then complete · cannot cancel a completed one
· third party cannot view.

### `module11.integration.test.js` — 27

Refresh tokens (5): cookie issued · rotation on refresh · **replay revokes the
whole family** · no cookie → 401 · logout invalidates.

Password reset (5): **same response for unknown addresses** (no enumeration) ·
reset works and signs in · **spent token cannot be reused** · garbage token
rejected · **reset revokes existing sessions**.

Notifications (6): verification raises one · unread count · mark one read ·
**another user cannot mark it read** · mark all · **no leakage between users**.

Audit log (6): sign-ins recorded · **failed sign-ins recorded** · category
filter · invalid category 400 · **patient cannot read it** · summary.

Analytics (3) and sorting (2): aggregated stats · transaction list · invalid
filter 400 · whitelisted sort honoured · **unknown sort field ignored, not
fatal**.

## Contract coverage — 38 tests

| Group | Highlights |
| --- | --- |
| Deployment | role assignment; zero address rejected |
| Registration | double registration rejected; non-registrar blocked; patient cannot be verified as a doctor |
| Anchoring | 1-based ids; duplicate hash per patient rejected; two patients may share a hash; empty CID / zero hash rejected; unregistered and wrong-role owners rejected |
| Access grants | **unverified doctor refused** · **only the owner may grant** · self-grant refused · past expiry refused · **grant lapses on its own** · immediate revocation · **access dies when verification is withdrawn** · access dies when the record is deactivated · owner always passes · unknown record returns false rather than reverting |
| Custodial grants | flagged `custodial=true`; stops working once `CUSTODIAN_ROLE` is revoked |
| Access logging | legitimate read logged; **cannot be forged for an unentitled viewer** |
| Integrity | match / mismatch; unknown record reverts |
| Emergency stop | anchoring blocked while paused; **revocation still works while paused**; only admin can pause |

## Two regression tests worth understanding

**Nonce collision.** One registrar key signs every write. Ethereum orders a
sender's transactions by a strictly incrementing nonce, and ethers derives it by
asking the node for the pending count — so two overlapping requests built
transactions with the same nonce and the second was rejected, silently marking
records `failed`. Awaiting each call is *not* enough, because the node's pending
count can lag a freshly mined block. The test uploads four records concurrently
and asserts four distinct on-chain ids.

**Refresh-token replay.** Because reuse of a spent token revokes the whole
family, a client that fires N parallel refreshes logs itself out. The test
asserts both halves: replay is rejected, *and* the legitimately rotated token is
revoked along with it. The frontend counters this with a single-flight refresh
promise.

## Linting

```bash
cd backend
npm run lint       # currently clean
npm run format
```

## Manual test script for a demo

1. Register a patient and a doctor (two browsers or profiles).
2. As admin, verify the doctor → the doctor's bell shows a notification.
3. As patient, upload a PDF → note "anchored on-chain".
4. Open the record → **Verify integrity** → green, chain confirms.
5. Share with the doctor, expiry tomorrow.
6. As doctor, open and download it → patient gets "a doctor opened your record".
7. As patient, revoke → doctor refreshes → 403.
8. Record detail → blockchain history shows anchor, grant, access, revoke.
9. As admin, audit log shows every step with actor, IP and timestamp.
10. Stop the Hardhat node, upload another record → still succeeds, status
    `pending`. Restart, `npm run backfill:anchors` → confirmed.

Step 10 is the one examiners tend to probe: it demonstrates that blockchain is
an integrity layer, not a single point of failure.

## Gaps, stated honestly

- **No unit tests** for `encryptionService`, `cid` or `pagination` in isolation.
  They are exercised through the integration suite, but a focused unit test
  would catch a regression faster.
- **No frontend component tests.** The UI is verified by build plus manual
  walkthrough.
- **Coverage is not measured.** No `c8`/`nyc` instrumentation is configured.
- The local IPFS driver's tamper test injects corruption directly on disk, which
  is not possible against Pinata; that test skips when `IPFS_DRIVER=pinata`.
