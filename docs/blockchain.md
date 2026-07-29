# Blockchain Layer — Module 4

Contract: `blockchain/contracts/TelemedicineRecords.sol`
Solidity 0.8.24 · OpenZeppelin 5 · Hardhat 2.29 · ethers v6

---

## What is and is not on-chain

| On-chain | Off-chain |
| --- | --- |
| SHA-256 of the plaintext document | The document itself (IPFS, encrypted) |
| IPFS CID of the ciphertext | Patient and doctor names, emails, diagnoses |
| Owner / uploader wallet addresses | The encryption envelope (MongoDB) |
| Record type as a `uint8` code | Titles, descriptions, tags |
| Every grant and revocation, as events | Searchable metadata |

Blockchain data is permanent and world-readable, which makes it the worst
possible place for clinical content. What is stored is the minimum needed to
make the off-chain system *provable*.

`profileRef` is `keccak256(mongoUserId)` — it links a wallet to an account
without publishing the id itself.

---

## Roles

| Role | Holder | Can do |
| --- | --- | --- |
| `DEFAULT_ADMIN_ROLE` | Deployer | Grant and revoke all roles |
| `ADMIN_ROLE` | Platform admin | Verify doctors, pause the contract |
| `REGISTRAR_ROLE` | Backend service key | Register participants, anchor records, log access |
| `CUSTODIAN_ROLE` | Backend service key | Grant access on a patient's behalf |

`CUSTODIAN_ROLE` is deliberately separate. The intended flow is that a patient
signs `grantAccess` with their own wallet — that is what makes "the patient owns
their data" cryptographically true rather than a claim. `grantAccessFor` exists
only so the platform stays usable for patients who have no wallet, and every
custodial grant emits `AccessGranted` with `custodial=true` so the audit trail
always distinguishes the two. In production:

```solidity
contract.revokeRole(CUSTODIAN_ROLE, backendAddress)
```

---

## Functions

### Registration
- `registerPatient(address, bytes32 profileRef)` — REGISTRAR
- `registerDoctor(address, bytes32 profileRef)` — REGISTRAR
- `verifyDoctor(address)` — ADMIN. Mirrors the Module 2 off-chain verification.
- `revokeDoctorVerification(address)` — ADMIN
- `deactivateParticipant(address)` — ADMIN

### Records
- `anchorRecord(address patient, bytes32 contentHash, string cid, uint8 recordType) → uint256`
  — REGISTRAR. Rejects a duplicate hash for the same patient, mirroring the
  backend's own duplicate check.
- `deactivateRecord(uint256)` — owner or REGISTRAR. Mirrors the soft delete;
  history is never erased.

### Access
- `grantAccess(uint256 recordId, address doctor, uint64 expiresAt)` — **owner only**
- `grantAccessFor(...)` — CUSTODIAN, flagged in the event
- `revokeAccess(uint256, address)` — owner or CUSTODIAN
- `hasAccess(uint256, address) view → bool` — the authorisation oracle
- `logAccess(uint256, address)` — REGISTRAR. Reverts unless the viewer really
  is entitled, so the log cannot be forged.

`expiresAt = 0` means the grant never expires.

### Views
`getRecord` · `getPatientRecordIds` · `getParticipant` · `getGrant` ·
`recordCount` · `verifyRecordIntegrity` · `isVerifiedDoctor`

---

## Access rules encoded in `hasAccess`

Returns `false` — without anyone calling revoke — when any of these hold:

- the record is inactive
- the grant was never made, or has been revoked
- the grant's `expiresAt` has passed
- the doctor's verification has been withdrawn
- the doctor's account has been deactivated

The owning patient always passes. An unverified doctor can never be granted
access in the first place.

---

## Security measures

| Measure | Why |
| --- | --- |
| OpenZeppelin `AccessControl` | Audited role management rather than hand-rolled `onlyOwner` |
| `Pausable` | Emergency stop. **Revocation still works while paused** — withdrawing consent must never be blocked by an operational incident |
| `ReentrancyGuard` | On the state-changing anchor path |
| Custom errors | Cheaper than revert strings, and precisely testable |
| Events on every state change | The audit trail *is* the event log |
| Checks-Effects-Interactions | State written before any external interaction |
| No `tx.origin` | Phishing-resistant |
| No unbounded loops in writes | Iteration only in `view` functions, which cost the caller nothing |
| `uint64` timestamps, packed structs | Lower storage cost |

---

## Backend integration

`backend/src/services/blockchainService.js` is the only module that imports
ethers. Everything above it deals in plain objects.

### Nonce serialisation

Every write is signed by one registrar key. Ethereum orders a sender's
transactions by a strictly incrementing nonce, and ethers derives that nonce by
asking the node for the pending transaction count. Two overlapping requests read
the same count and the second is rejected with *"nonce has already been used"*.

Awaiting each call is **not** sufficient — the node's pending count can lag a
freshly mined block, and concurrent requests are normal for a web API. So:

1. A promise chain serialises every submission — one transaction in flight.
2. The nonce is tracked in-process, seeded once from the chain.
3. Any failure drops the cached nonce, forcing a re-read.

Covered by the regression test *"anchors concurrent uploads without a nonce
collision"*.

### Graceful degradation

Anchoring happens **after** the record is encrypted, pinned and persisted, and
`anchorRecord` never throws. A chain outage leaves `blockchain.status` at
`pending` or `failed` instead of failing the upload. Nothing is ever lost:

```bash
npm run backfill:anchors
```

re-drives everything not yet confirmed. Safe to re-run — the contract rejects
duplicate hashes and confirmed records are skipped.

### Custodial identity addresses

The contract identifies participants by address, but a patient registering by
email has no wallet. Each user therefore gets a deterministic address derived
from `HMAC-SHA256(CUSTODIAL_WALLET_SEED, userId)`.

These are an **identity anchor only** — they never sign and never need gas; the
registrar submits and pays for everything. When a patient links a real wallet,
`walletType` flips to `external` and they sign their own grants.

> Changing `CUSTODIAL_WALLET_SEED` re-points every existing user at a new
> address, orphaning their on-chain history. Set it once and back it up.

---

## Running it

```bash
cd blockchain
npm install

npx hardhat compile
npx hardhat test                                        # 38 tests

npx hardhat node                                        # terminal 1
npx hardhat run scripts/deploy.js --network localhost   # terminal 2
```

The deploy script writes the address and ABI to
`backend/src/config/contracts/TelemedicineRecords.json`, so the API picks up a
fresh deployment with no manual copying. Then in `backend/.env`:

```ini
BLOCKCHAIN_ENABLED=true
CONTRACT_ADDRESS=<printed by the deploy script>
REGISTRAR_PRIVATE_KEY=<Hardhat account #1>
CUSTODIAL_WALLET_SEED=<64 hex chars>
```

Confirm with `GET /api/v1/health`:

```json
"blockchain": {
  "enabled": true, "connected": true,
  "chainId": 31337, "blockNumber": 18, "recordCount": "13"
}
```

### Deploying to Sepolia

```bash
cd blockchain
cp .env.example .env        # set SEPOLIA_RPC_URL and DEPLOYER_PRIVATE_KEY
npx hardhat run scripts/deploy.js --network sepolia
```

Then point `BLOCKCHAIN_RPC_URL` / `BLOCKCHAIN_CHAIN_ID` at Sepolia (11155111)
and raise `BLOCKCHAIN_CONFIRMATIONS` to 2 or more — a public chain can reorg,
which a single confirmation does not protect against.

---

## Test coverage — 38 tests

Deployment and roles · registration and double-registration · admin-only
verification · anchoring, duplicate hashes, empty CID, zero hash, wrong-role
owners · **unverified doctors refused access** · **non-owners refused the right
to grant** · self-granting · past expiry · **grants lapsing on their own** ·
immediate revocation · **access dying when verification is withdrawn** ·
custodial flagging and role revocation · forged access logs · integrity
match/mismatch · pause blocking anchors while still allowing revocation.
