# Blockchain-Based Secure Telemedicine System — Execution Plan

Last updated: 2026-07-29 · Modules 1–3 of 11 complete

Legend: `S` ≈ half a day · `M` ≈ 1–2 days · `L` ≈ 3–5 days

---

## 1. Status snapshot

| Area | State |
| --- | --- |
| Backend foundation, auth, RBAC | Done (M1) |
| Admin user + doctor verification | Done (M2) |
| Medical records, encryption, IPFS | Done (M3) |
| Service + repository layers | Introduced M3; M1–M2 not yet migrated |
| Smart contract / blockchain | Not started |
| Frontend | Not started |
| Appointments, notifications, audit log | Not started, **and unassigned in the original plan** |
| Documentation | Only `docs/api/medical-records.md` |
| Version control | **None — git is not installed** |

Backend API surface today: 6 auth endpoints, 6 admin endpoints, 7 record endpoints.

---

## 2. Decisions to make before writing more code

The original brief contains six redundancies or unassigned items. Resolving
them now avoids building something twice.

- [ ] **Formik vs React Hook Form** — both were listed. Recommend **React Hook Form + Yup**: lighter, fewer re-renders, and Formik is effectively in maintenance mode. Drop Formik.
- [ ] **Ganache vs Hardhat Network** — both were listed. Recommend **Hardhat Network only**. Ganache was sunset by Truffle/ConsenSys in 2023; Hardhat Network gives the same local chain plus `console.log` in Solidity and stack traces. Drop Ganache.
- [ ] **Refresh-token transport** — the brief lists refresh tokens, `cookie-parser` *and* "CSRF considerations", which only hang together if refresh tokens live in an httpOnly cookie. Recommend: access token in memory (Bearer), refresh token in an httpOnly `SameSite=Strict` cookie, plus a CSRF token on the refresh route. If you'd rather keep it simple, stay Bearer-only and drop `cookie-parser` + CSRF from the report.
- [ ] **Chart library** — the UI brief requires charts but no library was listed. Recommend **Recharts** (React-native API, composable, works with Bootstrap).
- [ ] **Appointments scope** — appointments appear in the DB design and in both the patient and doctor modules, but no module owned them. Slotted below as **Module 6b**. Confirm they're in scope; cutting them is the single biggest scope saving available.
- [ ] **Wallet model** — does each *user* connect MetaMask (true decentralisation, patient pays gas), or does the backend hold one custodial signer (simpler demo, patient never sees gas)? This materially changes Modules 4, 5 and 8. Recommend **custodial backend signer for record anchoring + MetaMask for patient-signed access grants** — the interesting part is on-chain, the tedious part isn't.

Already resolved, no action needed:

- ~~Separate `Patients` / `Doctors` / `Admins` collections~~ → unified into one `User` model with `role` + `patientProfile` / `doctorProfile` subdocuments. This is the correct design; the brief's "models" list is satisfied.

---

## 3. Do first (blockers, not features)

- [ ] **Install Git and initialise the repository** `S` — there is no version control on this project at all. `.gitignore` already exists and is correct. One accidental delete currently loses everything.
  - Install from git-scm.com, then `git init`, `git add .`, first commit.
  - Confirm `backend/.env` and `.local/` are ignored **before** the first commit — `.env` contains `FILE_ENCRYPTION_KEY`.
- [ ] **Root `README.md`** `S` — required by the brief, and currently absent. Prerequisites, install, run, seed, test, architecture diagram, module status.
- [ ] **Back up `FILE_ENCRYPTION_KEY`** `S` — losing it makes every stored medical record permanently unreadable. Keep a copy outside the project folder.
- [ ] **ESLint + Prettier** `S` — listed in the brief's toolchain, not yet configured. Cheapest now, before the codebase triples in size.

---

## 4. Module 4 — Smart contract, Hardhat, ethers.js `L`

Creates the `blockchain/` workspace. Nothing here touches the frontend.

- [ ] Scaffold `blockchain/` with Hardhat, `hardhat.config.js`, OpenZeppelin contracts
- [ ] `contracts/TelemedicineRecords.sol`
  - [ ] `registerPatient` / `registerDoctor` — wallet ↔ role mapping
  - [ ] `verifyDoctor` — admin-only, mirrors the M2 off-chain verification
  - [ ] `uploadRecordHash(patient, cid, sha256Hash, recordType)` → emits `RecordUploaded`
  - [ ] `grantAccess(recordId, doctor, expiresAt)` → emits `AccessGranted`
  - [ ] `revokeAccess(recordId, doctor)` → emits `AccessRevoked`
  - [ ] `hasAccess(recordId, doctor)` view — the authorisation oracle for M5/M6
  - [ ] `getRecordsByPatient(patient)` view
  - [ ] Access modifiers via OpenZeppelin `AccessControl`; `ReentrancyGuard` where value moves
  - [ ] Custom errors over `require` strings (gas), events on every state change (audit trail)
- [ ] `test/TelemedicineRecords.test.js` — role enforcement, grant/revoke lifecycle, expiry, unauthorised-caller reverts, event emission
- [ ] `scripts/deploy.js` + Hardhat Ignition module
- [ ] Backend `src/services/blockchainService.js` — ethers.js provider/signer factory, ABI loading, tx submission with retry, receipt confirmation
- [ ] Backend `src/config/blockchain.js` + env: `RPC_URL`, `CHAIN_ID`, `CONTRACT_ADDRESS`, `DEPLOYER_PRIVATE_KEY`
- [ ] `models/BlockchainTransaction.js` — tx hash, type, status, gas, block, related record
- [ ] Wire anchoring into the existing upload flow so `blockchain.status` moves `pending → confirmed`
- [ ] Backfill script for records already uploaded under M3

**Note:** M3 deliberately stamps every record `blockchain.status: "pending"`, so no data migration is needed — only a backfill run.

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
Git + README + ESLint          (§3 — do this week, it is 1 day total)
        ↓
Module 4  contract + anchoring        ← the differentiator; everything cites it
        ↓
Module 5  sharing                     ← unlocks doctor work
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
