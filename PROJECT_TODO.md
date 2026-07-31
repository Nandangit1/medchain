# Blockchain-Based Secure Telemedicine System — Status

Last updated: 2026-07-30 · **All 11 modules complete**

144 automated tests passing: 32 unit, 74 API integration, 38 smart contract.
Backend lint clean. Frontend builds clean with route-level code splitting.

---

## 1. Delivered

| Module | Scope | Tests |
| --- | --- | --- |
| 1 | Backend foundation, env validation, JWT auth, RBAC | — |
| 2 | Admin doctor verification, user management | — |
| 3 | Medical records, AES-256-GCM envelope encryption, pluggable IPFS | 17 |
| 4 | Solidity contract, Hardhat, ethers, anchoring, backfill | 38 |
| 5 | Record sharing, grant/revoke, on-chain history | 21 |
| 6 | Doctor workflows, diagnoses, prescriptions | (in 5) |
| 6b | Appointments with an enforced status lifecycle | 9 |
| 7 | React foundation, Axios + refresh, guards, theming | — |
| 8 | Patient portal | — |
| 9 | Doctor portal | — |
| 10 | Admin portal, analytics, audit viewer, tx explorer | — |
| 11 | Refresh tokens, password reset, audit log, notifications, logging, docs | 27 + 32 |

### Endpoint inventory

**Auth** `/auth` — register · login · refresh · logout · me (GET/PATCH) ·
change-password · forgot-password · reset-password

**Records** `/records` — upload · list · get · download · verify · history ·
update · delete · access · share · unshare

**Patient** `/patients/me` — dashboard · grants · wallet

**Doctor** `/doctors` — directory · me/dashboard · me/patients · me/records ·
me/diagnoses · records/:id/diagnoses (GET/POST) · patients/:id/prescriptions

**Appointments** `/appointments` — create · list · get · confirm · cancel ·
complete · no-show

**Notifications** `/notifications` — list · unread-count · read · read-all

**Admin** `/admin` — stats · users · users/:id · users/:id/status · doctors ·
doctors/:id/verify · doctors/:id/reject · audit-logs · audit-summary ·
blockchain/transactions

**Health** `/health` — DB, IPFS driver and chain status in one call

---

## 2. Outstanding — yours, not the code's

- [ ] **Back up `FILE_ENCRYPTION_KEY` and `CUSTODIAL_WALLET_SEED`** from
      `backend/.env`. They are git-ignored by design, so they exist in exactly
      one place on disk. Losing the first makes every stored record permanently
      unreadable; losing the second orphans every user's on-chain identity.
      **Copy them somewhere outside the project folder.**
- [ ] Change the seeded admin password — the default is in the repository.
- [ ] Capture screenshots into `docs/screenshots/` for the report appendix.
- [ ] Render the Mermaid diagrams to PNG/SVG for Word/LaTeX (see
      `docs/README.md`).

---

## 3. Known limitations, stated deliberately

Each of these is documented rather than hidden, and each has a prepared answer in
`docs/viva-questions.md`.

| Limitation | Detail | Where discussed |
| --- | --- | --- |
| Encryption is server-side, not end-to-end | The server holds the master key and sees plaintext in memory. A compromised server compromises confidentiality. | Q10 |
| Key loss is unrecoverable | No recovery path for `FILE_ENCRYPTION_KEY`, by design. | Q7 |
| ~~MIME allow-list trusts `Content-Type`~~ | **CLOSED.** Magic-byte verification now runs after Multer and rejects content that disagrees with the declared type — a Windows executable labelled `application/pdf` is refused with 415. | Q29 |
| Local CIDs differ from Kubo's for large files | Valid CIDv1 raw+sha256, but IPFS chunks above 256 KiB into a UnixFS DAG. | Q38 |
| Backend does not scale horizontally yet | The nonce counter is in-process; two instances on one registrar key would collide. | Q37 |
| Rate limiting is per-process | `express-rate-limit` uses in-memory counters; needs Redis behind multiple instances. | deployment-guide §0 |
| Custodial grants weaken the ownership claim | Most grants are platform-signed. Mitigated: separate revocable role, `custodial=true` on-chain. | Q12, Q40 |
| ~~M1–M2 controllers bypass repositories~~ | **CLOSED.** `authController`, `adminController` and `doctorService` now go through `userRepository`. No controller imports a Mongoose model. | Q20 |
| No frontend component tests | UI verified by build plus manual walkthrough. | testing-guide |
| Coverage not instrumented | No c8/nyc configured. | testing-guide |
| No mail transport | Reset links are written to the application log. | authController |

---

## 4. Optional next steps

Not required for submission; listed in rough order of value.

- [ ] Frontend component tests (Vitest + React Testing Library)
- [ ] Coverage reporting (`c8`)
- [x] ~~Migrate `authController` / `adminController` onto repositories~~
- [x] ~~Magic-byte file-type sniffing~~
- [ ] Deploy to Sepolia and record the address in the report
- [ ] Switch `IPFS_DRIVER=pinata` and verify against real IPFS
- [ ] SMTP transport for password-reset emails
- [ ] Redis-backed rate limiting
- [ ] Docker Compose for one-command startup
- [ ] Accessibility audit (axe) and a keyboard-only pass

---

## 5. Running it

Five terminals. Full detail in [`docs/installation-guide.md`](docs/installation-guide.md).

```bash
# 1  MongoDB
.local/mongodb/mongodb-win32-x86_64-windows-8.3.4/bin/mongod.exe \
  --dbpath .local/mongodb/data --port 27017 --logpath .local/mongodb/mongod.log

# 2  Local chain
cd blockchain && npx hardhat node

# 3  Deploy (exits when done)
cd blockchain && npx hardhat run scripts/deploy.js --network localhost

# 4  API — set CONTRACT_ADDRESS + BLOCKCHAIN_ENABLED=true in backend/.env first
cd backend && npm run seed:admin && npm run dev

# 5  Frontend
cd frontend && npm run dev            # http://localhost:3000
```

Sign in as `admin@example.com` / `Admin@12345`.

```bash
# Tests
cd backend    && npm run test:all     # 106
cd blockchain && npx hardhat test     # 38
```

---

## 6. Architecture summary

`routes → validators → controller → service → repository → model`, dependencies
pointing downward only.

- Files are AES-256-GCM encrypted before leaving the server. A random per-file
  content key is wrapped with `FILE_ENCRYPTION_KEY`; only the wrapped form is
  persisted.
- `integrity.fileHash` is SHA-256 of the **plaintext** — the value anchored
  on-chain, and the one a patient can recompute from their own copy.
- IPFS goes through a factory with two interchangeable drivers (`local`,
  `pinata`) selected by `IPFS_DRIVER`.
- Authorisation is checked twice: MongoDB decides, the chain may veto. An
  unreachable chain does not lock clinicians out.
- Administrators can read metadata and verify integrity, but never a clinical
  file.
- Anchoring never fails an upload; failures leave `blockchain.status` recoverable
  via `npm run backfill:anchors`.

## 7. Decisions made along the way

Recorded because they belong in the report's design-rationale section.

- **React Hook Form over Formik** — fewer re-renders; Formik is effectively in
  maintenance mode.
- **Hardhat Network over Ganache** — Ganache was sunset by Truffle in 2023.
- **Recharts** for charts (the brief required charts but named no library).
- **Refresh tokens in httpOnly `SameSite=Strict` cookies**, access token in
  memory — an XSS payload can then steal at most a short-lived token.
- **Custodial identity addresses** derived from a server seed, so records can be
  anchored before a patient installs MetaMask. They never sign and never need gas.
- **One `User` collection** with a role discriminator rather than three
  collections.
- **Hardhat Ignition dropped** — `scripts/deploy.js` already deploys and
  publishes the ABI; Ignition would be a second way to do the same job.
