# Blockchain-Based Secure Telemedicine System — Execution Plan

Last updated: 2026-07-29 · Modules 1–4 of 11 complete

Legend: `S` ≈ half a day · `M` ≈ 1–2 days · `L` ≈ 3–5 days

---

## 1. Status snapshot

| Area | State |
| --- | --- |
| Backend foundation, auth, RBAC | Done (M1) |
| Admin user + doctor verification | Done (M2) |
| Medical records, encryption, IPFS | Done (M3) |
| Service + repository layers | Introduced M3; M1–M2 not yet migrated |
| Smart contract / blockchain | Done (M4) — deployed locally, anchoring live |
| Frontend | Not started |
| Appointments, notifications, audit log | Not started, **and unassigned in the original plan** |
| Documentation | README, records API, blockchain layer |
| Version control | Git installed, repo initialised, first commit made |

Backend API surface today: 6 auth endpoints, 6 admin endpoints, 7 record endpoints.
Tests: 17 API integration + 38 smart contract, all passing.

---

## 2. Decisions — resolved

The original brief contained six redundancies or unassigned items. All are now
settled; the rationale is kept here because it belongs in the report.

- [x] **Formik vs React Hook Form** → **React Hook Form + Yup**. Lighter, fewer re-renders, and Formik is effectively in maintenance mode. Formik dropped.
- [x] **Ganache vs Hardhat Network** → **Hardhat Network only**. Ganache was sunset by Truffle/ConsenSys in 2023; Hardhat gives the same local chain plus Solidity `console.log` and stack traces. Ganache dropped.
- [x] **Chart library** → **Recharts**. The UI brief required charts but named no library.
- [x] **Appointments scope** → in scope, slotted as **Module 6b**. Still the single biggest scope cut available if time runs short.
- [x] **Wallet model** → **custodial identity + patient-signed grants.** Each user gets a deterministic address derived from a server seed, so records can be anchored before anyone installs MetaMask. Those addresses never sign and never need gas. Patients who link a real wallet sign their own grants; `CUSTODIAN_ROLE` covers everyone else and is separately revocable. See `docs/blockchain.md`.
- [ ] **Refresh-token transport** — the only one still open, and it is not blocking. The brief lists refresh tokens, `cookie-parser` *and* "CSRF considerations", which cohere only if refresh tokens live in an httpOnly cookie. Recommended: access token in memory (Bearer), refresh token in an httpOnly `SameSite=Strict` cookie, plus a CSRF token on the refresh route. Decide before Module 7, since it shapes the Axios client.

Already resolved before this plan existed:

- ~~Separate `Patients` / `Doctors` / `Admins` collections~~ → unified into one `User` model with `role` + `patientProfile` / `doctorProfile` subdocuments.

---

## 3. Blockers — cleared

- [x] **Git installed and repository initialised** — Git 2.55 installed via winget; `git init` done, first commit made. Verified before committing that `backend/.env`, `node_modules/`, `.local/` and the blockchain build output are all ignored, and that no key material appears in the staged diff.
- [x] **Root `README.md`** — architecture, prerequisites, quick start, security table, API summary, module status.
- [ ] **Back up `FILE_ENCRYPTION_KEY` and `CUSTODIAL_WALLET_SEED`** `S` — **still outstanding, and it is on you.** Both live only in `backend/.env`, which is git-ignored by design. Losing the first makes every stored record permanently unreadable; losing the second orphans every user's on-chain identity. Copy them somewhere outside the project folder today.
- [ ] **ESLint + Prettier** `S` — still not configured. Cheapest now, before the frontend triples the codebase.

---

## 4. Module 4 — Smart contract, Hardhat, ethers.js — **COMPLETE**

- [x] `blockchain/` workspace: Hardhat 2.29, OpenZeppelin 5, ethers v6, Solidity 0.8.24
- [x] `contracts/TelemedicineRecords.sol` — registration, admin verification, `anchorRecord`, `grantAccess` / `grantAccessFor` / `revokeAccess`, `hasAccess` oracle, `logAccess`, `verifyRecordIntegrity`, full view surface
- [x] `AccessControl` + `Pausable` + `ReentrancyGuard`, custom errors, events on every state change
- [x] `test/TelemedicineRecords.test.js` — **38 tests passing**
- [x] `scripts/deploy.js` — writes address + ABI straight into the backend, so a deployment self-wires
- [x] `backend/src/config/blockchain.js`, `services/blockchainService.js`, `models/BlockchainTransaction.js`
- [x] Anchoring wired into the upload flow; `blockchain.status` moves `pending → confirmed`
- [x] `npm run backfill:anchors` for records uploaded before the chain existed
- [x] `GET /api/v1/health` now reports chain connectivity, block height and record count
- [x] On-chain integrity check surfaced in `GET /records/:id/verify`

**Two bugs found and fixed during this module** (both worth writing up):

1. **Nonce collision.** One registrar key signs every write; concurrent uploads read the same pending nonce and the second was rejected with *"nonce has already been used"*, silently downgrading records to `failed`. Fixed by serialising submissions behind a queue with an in-process nonce counter. Regression test: *"anchors concurrent uploads without a nonce collision"*.
2. **Failure logs silently dropped.** The full ethers error embeds the raw signed transaction (thousands of characters) and was written into a field capped at 1000, so the validation error was swallowed by the logger's own catch — failures left no trace at all. Errors are now truncated before logging.

**Not carried over from the original scope:** Hardhat Ignition. `scripts/deploy.js`
already handles deployment and artifact publication; Ignition would add a second
way to do the same thing.

---

## 5. Module 5 — Patient sharing + blockchain history `M`

- [ ] `models/AccessPermission.js` — record, patient, doctor, grantedAt, expiresAt, revokedAt, on-chain tx refs
- [ ] `repositories/accessPermissionRepository.js`
- [ ] `services/accessControlService.js` — dual check: MongoDB row **and** on-chain `hasAccess`
- [ ] `POST /api/v1/records/:recordId/share` — grant a doctor access (on-chain + off-chain)
- [ ] `DELETE /api/v1/records/:recordId/share/:doctorId` — revoke
- [ ] `GET /api/v1/records/:recordId/access` — who can currently see this
- [ ] `GET /api/v1/records/:recordId/history` — on-chain event timeline
- [ ] `GET /api/v1/patients/me/blockchain-history` — all anchoring + access events
- [ ] Extend `medicalRecordService` authorisation so a granted doctor passes `assertCanReadContent`
- [ ] Expiring grants — background sweep or lazy check on read
- [ ] Integration tests: grant → doctor reads → revoke → doctor gets 403

---

## 6. Module 6 — Doctor clinical workflows `M`

- [ ] `GET /api/v1/doctors/me/patients` — patients who have shared with this doctor
- [ ] `GET /api/v1/doctors/me/records` — all records shared with this doctor
- [ ] `GET /api/v1/records/:recordId/download` — extend to granted doctors
- [ ] `models/Diagnosis.js` + create/list endpoints, linked to a record
- [ ] Prescription upload — reuses the M3 encrypt→IPFS→anchor pipeline with `recordType: prescription`, `uploadedBy: doctor`
- [ ] Allow verified doctors to upload **for** a patient (currently patient-only by design)
- [ ] `requireVerifiedDoctor` on every route here
- [ ] Integration tests: unverified doctor blocked, non-granted doctor blocked

### Module 6b — Appointments `M` *(unassigned in the original plan — confirm scope)*

- [ ] `models/Appointment.js` — patient, doctor, slot, status, reason, notes
- [ ] Patient: request, list, cancel
- [ ] Doctor: list, accept/reject, complete, add notes
- [ ] Double-booking prevention (unique index on doctor + slot)
- [ ] Status lifecycle: `requested → confirmed → completed | cancelled | no_show`

---

## 7. Module 7 — React foundation `L`

- [ ] Vite + React scaffold in `frontend/`
- [ ] Folder structure per brief: `components/{common,layout,forms,tables,cards,buttons,sidebar,navbar}`, `pages/`, `hooks/`, `context/`, `services/`, `utils/`, `routes/`, `styles/`
- [ ] Axios client with interceptors (attach token, handle 401, refresh flow)
- [ ] `AuthContext` + `useAuth`
- [ ] `ProtectedRoute` / `RoleRoute` guards
- [ ] Bootstrap 5 theme, healthcare palette, dark-mode CSS variables
- [ ] Layout shell: sidebar, navbar, breadcrumbs
- [ ] React Toastify, React Icons
- [ ] Global `ErrorBoundary`, loading skeletons, 404 page
- [ ] Public pages: Home, About, Contact
- [ ] Auth pages: Login, Register (patient + doctor variants), Forgot Password

---

## 8. Module 8 — Patient UI `L`

- [ ] Dashboard: record counts, recent uploads, pending grants, blockchain status tiles
- [ ] Upload form with drag-and-drop, client-side type/size validation, progress
- [ ] Record list: filter, search, sort, paginate
- [ ] Record detail: metadata, integrity badge, on-chain proof link
- [ ] Share modal: pick a verified doctor, set expiry, MetaMask signature
- [ ] Access management: active grants, revoke
- [ ] Blockchain history timeline
- [ ] MetaMask connect + network guard
- [ ] Profile and settings

---

## 9. Module 9 — Doctor UI `M`

- [ ] Dashboard: shared patients, today's appointments, pending reviews
- [ ] Shared patient list and record viewer
- [ ] Diagnosis form
- [ ] Prescription upload
- [ ] Appointment management
- [ ] Verification-status banner for unverified doctors
- [ ] Profile

---

## 10. Module 10 — Admin UI `M`

- [ ] Dashboard with analytics — users by role, uploads over time, verification queue (Recharts)
- [ ] Doctor verification queue: review, verify, reject with reason
- [ ] User management: search, filter, activate/deactivate
- [ ] Blockchain transaction explorer
- [ ] Audit log viewer with filters
- [ ] System settings page

---

## 11. Module 11 — Hardening, docs, deployment `L`

### Cross-cutting features still missing

- [ ] **Forgot / reset password** — in the brief, owned by no module. Token model, email or console transport, reset endpoints, UI
- [ ] **Refresh tokens** — per the decision in §2
- [ ] **`models/AuditLog.js` + audit middleware** — the brief requires an audit trail; nothing writes one today
- [ ] **`models/Notification.js`** + endpoints + UI bell
- [ ] **Sorting** — `pagination.js` hardcodes `createdAt: -1`; the brief asks for sorting. Add a whitelisted `sort` query param
- [ ] **Structured logging** — `logs/` is in the brief's structure but Morgan only writes to stdout. Add Winston with rotation
- [ ] **Migrate M1–M2 controllers onto repositories** — `authController` and `adminController` still call Mongoose directly, inconsistent with M3

### Testing

- [ ] Unit tests: `encryptionService`, `cid`, `hash`, `pagination`, access rules
- [ ] Integration tests for auth and admin (only records are covered today)
- [ ] Smart contract tests (M4)
- [ ] Frontend component tests
- [ ] Postman collection covering every endpoint

### Documentation

- [ ] README (moved to §3 — do it early)
- [ ] Full API documentation (only records documented today)
- [ ] ER diagram
- [ ] DFD (levels 0 and 1)
- [ ] Class diagram
- [ ] Sequence diagrams — upload, grant access, doctor read
- [ ] Component diagram
- [ ] Installation guide
- [ ] Deployment guide
- [ ] Testing guide
- [ ] Viva question bank
- [ ] IEEE report content
- [ ] `docs/screenshots/`

### Production hardening

- [ ] Switch `IPFS_DRIVER=pinata` and verify against real IPFS
- [ ] Deploy the contract to a public testnet (Sepolia) and record the address
- [ ] Per-route rate limits (auth and upload are stricter than reads)
- [ ] Helmet CSP tuned for the frontend
- [ ] Responsive pass, accessibility pass
- [ ] Seed script for demo data

---

## 12. Suggested order

```
Git + README                   ✔ done
Module 4  contract + anchoring ✔ done
        ↓
Module 5  sharing                     ← NEXT. unlocks all doctor work
        ↓
Module 6  doctor workflows  (+6b appointments if in scope)
        ↓
Module 7  React foundation            ← nothing UI ships before this
        ↓
Modules 8, 9, 10  dashboards          ← parallelisable if you have a teammate
        ↓
Module 11 hardening + docs            ← start docs earlier; do not leave to the end
```

**Two warnings from experience:**

1. Do not leave §11's documentation to the end. Write each diagram as you finish
   the module it describes, while the design is still in your head.
2. Module 4 is the highest-risk item — contract bugs are expensive to find late,
   and the entire project's novelty rests on it. Budget more time than feels
   necessary and write the contract tests *first*.

---

## 13. Architecture reference

- Layered: `routes → validators → controllers → services → repositories → MongoDB`
- Medical files are AES-256-GCM encrypted before leaving the server. A random
  per-file content key is wrapped with `FILE_ENCRYPTION_KEY`; only the wrapped
  key is persisted. See `docs/api/medical-records.md`.
- `integrity.fileHash` is the SHA-256 of the **plaintext** — the value Module 4
  anchors on-chain.
- IPFS access goes through a factory (`backend/src/services/ipfs/`) with two
  interchangeable drivers: `local` (on-disk, content-addressed, no credentials)
  and `pinata` (real IPFS). Selected by `IPFS_DRIVER`.
- Admins can read record metadata and verify integrity, but never plaintext.

## 14. Running locally

```bash
# 1. MongoDB (bundled)
.local/mongodb/mongodb-win32-x86_64-windows-8.3.4/bin/mongod.exe `
  --dbpath .local/mongodb/data --port 27017 --logpath .local/mongodb/mongod.log

# 2. API
cd backend
npm install
npm run seed:admin        # first run only
npm run dev               # http://localhost:5000

# 3. Tests (API must be running)
npm run test:integration
```

## 15. Endpoint inventory

**Auth** — `POST /auth/register` · `POST /auth/login` · `POST /auth/logout` · `GET /auth/me` · `PATCH /auth/me` · `PATCH /auth/change-password`

**Admin** — `GET /admin/users` · `GET /admin/users/:userId` · `PATCH /admin/users/:userId/status` · `GET /admin/doctors` · `PATCH /admin/doctors/:doctorId/verify` · `PATCH /admin/doctors/:doctorId/reject`

**Records** — `POST /records` · `GET /records` · `GET /records/:recordId` · `GET /records/:recordId/download` · `GET /records/:recordId/verify` · `PATCH /records/:recordId` · `DELETE /records/:recordId`

All prefixed `/api/v1`.
