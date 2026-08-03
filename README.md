# Blockchain-Based Secure Telemedicine System

A telemedicine platform where patients own their medical data. Reports are
encrypted client-side of the storage boundary, stored on IPFS, and anchored on
Ethereum so that every upload and every access grant is tamper-evident and
independently verifiable.

> BE Final Year Project · Node.js · Express · MongoDB · Solidity · IPFS · React

---

## The core idea

Medical files are **never** written to the blockchain — that would be expensive,
permanent, and a privacy disaster. Instead:

```
                    ┌─────────────────────────────────────────┐
   report.pdf  ──▶  │  sha256(plaintext)   ← identity of the  │
                    │                        document         │
                    │  AES-256-GCM encrypt with a random      │
                    │  per-file content key                   │
                    │            ↓                            │
                    │  content key wrapped with master key    │
                    └─────────────────────────────────────────┘
                                 ↓                    ↓
                        ciphertext → IPFS      envelope → MongoDB
                                 ↓
                              CID + hash → Ethereum
```

Only the **hash** and the **CID** reach the chain. The chain proves *what* was
stored and *when*, and who was authorised to read it. IPFS holds the bytes.
MongoDB holds the searchable metadata and the wrapped key.

Because the hash is taken over the **plaintext**, a patient can prove years
later that the document they hold is byte-identical to the one they uploaded —
regardless of how it was encrypted or which storage provider held it.

---

## Architecture

```
Presentation      React 18 · React Router · Bootstrap 5 · Context API
      ↓ REST
API Layer         Express · Helmet · CORS · rate limiting · express-validator
      ↓
Controllers       HTTP adapters only — no business rules
      ↓
Services          auth · medicalRecord · encryption · ipfs · blockchain
      ↓
Repositories      all persistence isolated behind an interface
      ↓
Data              MongoDB (metadata, wrapped keys, permissions)
      ↓
Blockchain        Ethereum / Hardhat — hashes, CIDs, access events
      ↓
Storage           IPFS via Pinata (pluggable driver)
```

Design patterns in use: MVC, Repository, Service Layer, Factory (IPFS driver
selection), Middleware, and reusable React components.

---

## Repository layout

```
blockchain-telemedicine/
├── backend/              Express API
│   ├── src/
│   │   ├── config/       env validation, database, blockchain
│   │   ├── constants/    roles, record types, MIME allow-list
│   │   ├── controllers/  HTTP adapters
│   │   ├── middlewares/  auth, validation, upload, error handling
│   │   ├── models/       Mongoose schemas
│   │   ├── repositories/ persistence layer
│   │   ├── routes/       route definitions
│   │   ├── services/     business logic
│   │   ├── utils/        hashing, CIDs, pagination, responses
│   │   └── validators/   express-validator rule sets
│   └── tests/            integration tests (node:test)
├── blockchain/           Hardhat workspace
│   ├── contracts/        Solidity sources
│   ├── scripts/          deployment
│   └── test/             contract tests
├── frontend/             React application
├── docs/                 API docs, diagrams, guides
└── .local/               MongoDB + local IPFS data (git-ignored)
```

---

## Prerequisites

| Tool | Version | Notes |
| --- | --- | --- |
| Node.js | ≥ 18.18 | 20 LTS or newer recommended |
| MongoDB | 6+ | A portable copy ships under `.local/mongodb` |
| Git | any | Required for version control |
| MetaMask | latest | Browser extension, for the frontend |

Pinata credentials are **optional** — the project runs fully offline using the
local IPFS driver.

---

## Always-on mode

If you just want the site to *be there* — surviving a closed editor, a closed
terminal and a reboot — skip the five manual steps below and run:

```powershell
npm run site:install
```

That starts the whole stack detached and registers a logon task, so
**http://localhost:3000** comes back by itself every time you sign in to
Windows. No Administrator rights needed; if the task store refuses an
unelevated write the script falls back to a Startup-folder entry.

```powershell
npm run site            # start now, without installing autostart
npm run site:status     # what is up, and whether autostart is installed
npm run site:stop       # stop everything
npm run site:rebuild    # rebuild the frontend, then start
npm run site:uninstall  # remove autostart (leaves the site running)
```

The stack runs in production shape: one Node process serves both the built
React app and the API on port 3000.

**Why this needs a script rather than a shortcut.** Hardhat keeps its chain in
memory, so every restart destroys the contract and orphans the on-chain ids
stored in MongoDB — records would show as unverifiable. On each start the
script asks the chain whether `CONTRACT_ADDRESS` still holds code; when it does
not, it redeploys, writes the new address into `backend/.env`, and re-anchors
every live record before the site accepts traffic. When the chain is intact all
of that is skipped and startup takes a couple of seconds.

Logs land in `.local/logs/` (`app.log`, `hardhat.log`, `backfill.log`).

> For day-to-day development use the Quick start below instead — always-on mode
> serves a build, so code edits do not appear until `npm run site:rebuild`.

---

## Quick start

### 1. Start MongoDB

```powershell
.local/mongodb/mongodb-win32-x86_64-windows-8.3.4/bin/mongod.exe `
  --dbpath .local/mongodb/data --port 27017 --logpath .local/mongodb/mongod.log
```

Create `.local/mongodb/data` first if it does not exist.

### 2. Configure and start the API

```bash
cd backend
npm install
cp .env.example .env
```

Generate the master encryption key and paste it into `.env`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Then:

```bash
npm run seed:admin     # first run only — creates the admin account
npm run dev            # http://localhost:5000
```

Verify: `GET http://localhost:5000/api/v1/health` should report
`"database": "connected"`.

### 3. Start the blockchain (optional but recommended)

```bash
cd blockchain
npm install
npx hardhat node                                        # terminal A
npx hardhat run scripts/deploy.js --network localhost   # terminal B
```

Copy the printed contract address into `backend/.env` as `CONTRACT_ADDRESS`,
set `BLOCKCHAIN_ENABLED=true`, and restart the API. With it disabled the whole
platform still works — records simply stay at `blockchain.status: "pending"`
until `npm run backfill:anchors` is run.

### 4. Start the frontend

```bash
cd frontend
npm install
cp .env.example .env
npm run dev            # http://localhost:3000
```

Open **http://localhost:3000**.

The dev server proxies `/api` to the backend on port 5000, so the browser only
ever talks to one origin. That is why `VITE_API_URL` is relative (`/api/v1`):
no CORS preflights, and the httpOnly refresh cookie works without special
cases.

<details>
<summary>Optional: run it as a single server, or as <code>medchain.local</code></summary>

**Single server** — one process serves the built app and the API on port 80:

```bash
npm run build                      # from the repository root
cd backend && npm run start:site   # http://localhost
```

**Custom hostname** — maps `medchain.local` to this machine. Needs
Administrator rights because it edits the Windows hosts file:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup-hostname.ps1
```

Undo with `-Remove`. `localhost` keeps working either way, so this step is
entirely optional.

</details>

### 5. Run the tests

With MongoDB, the API and the Hardhat node running:

```bash
cd backend    && npm run test:integration    # 47 API tests
cd blockchain && npx hardhat test            # 38 contract tests
```

---

## Configuration

`backend/.env`:

```ini
NODE_ENV=development
PORT=5000
MONGODB_URI=mongodb://127.0.0.1:27017/blockchain_telemedicine

JWT_SECRET=<at least 32 characters>
JWT_EXPIRES_IN=1d
CORS_ORIGIN=http://localhost:3000

ADMIN_NAME=System Admin
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=Admin@12345

# Wraps every per-file content key. 32 bytes as 64 hex characters.
FILE_ENCRYPTION_KEY=<64 hex chars>

IPFS_DRIVER=local                 # local | pinata
LOCAL_IPFS_PATH=./.local/ipfs
PINATA_JWT=                       # required when IPFS_DRIVER=pinata
PINATA_API_URL=https://api.pinata.cloud
PINATA_GATEWAY_URL=https://gateway.pinata.cloud

MAX_UPLOAD_SIZE_MB=10
```

> **`FILE_ENCRYPTION_KEY` is not recoverable.** If it is lost, every stored
> medical record becomes permanently unreadable. Back it up outside the project
> folder and use a different key per environment.

### Switching to real IPFS

Set `IPFS_DRIVER=pinata` and supply `PINATA_JWT`, then restart. No code changes
— the factory in `backend/src/services/ipfs/index.js` resolves the driver at
startup. CIDs created under the local driver will not resolve on the public
network, so switch before loading demonstration data.

---

## Security

| Control | Implementation |
| --- | --- |
| Authentication | JWT bearer tokens, 1-day expiry |
| Password storage | bcrypt, cost factor 12 |
| Authorisation | Role-based (`patient` / `doctor` / `admin`) plus per-record grants |
| File confidentiality | AES-256-GCM envelope encryption before storage |
| File integrity | SHA-256 over plaintext, re-verified on every read |
| Transport hardening | Helmet, CORS allow-list, compression |
| Abuse prevention | express-rate-limit, 200 requests / 15 min |
| Injection | express-mongo-sanitize (including multipart bodies), hpp |
| Upload safety | MIME allow-list, size cap, memory storage — plaintext never hits disk |

**Deliberate design choice:** administrators can read record *metadata* and run
integrity checks, but can never download a patient's file. An operator needs to
run the platform, not read pathology reports.

---

## API

Base URL: `http://localhost:5000/api/v1`

| Group | Endpoints |
| --- | --- |
| Health | `GET /health` |
| Auth | `POST /auth/register` · `POST /auth/login` · `POST /auth/logout` · `GET /auth/me` · `PATCH /auth/me` · `PATCH /auth/change-password` |
| Admin | `GET /admin/users` · `GET /admin/users/:id` · `PATCH /admin/users/:id/status` · `GET /admin/doctors` · `PATCH /admin/doctors/:id/verify` · `PATCH /admin/doctors/:id/reject` |
| Records | `POST /records` · `GET /records` · `GET /records/:id` · `GET /records/:id/download` · `GET /records/:id/verify` · `GET /records/:id/history` · `PATCH /records/:id` · `DELETE /records/:id` |
| Sharing | `GET /records/:id/access` · `POST /records/:id/share` · `DELETE /records/:id/share/:doctorId` |
| Patient | `GET /patients/me/dashboard` · `GET /patients/me/grants` · `GET /patients/me/wallet` |
| Doctor | `GET /doctors/directory` · `GET /doctors/me/dashboard` · `GET /doctors/me/patients` · `GET /doctors/me/records` · `GET /doctors/me/diagnoses` · `POST /doctors/records/:id/diagnoses` · `POST /doctors/patients/:id/prescriptions` |
| Appointments | `POST /appointments` · `GET /appointments` · `GET /appointments/:id` · `PATCH /appointments/:id/confirm` · `PATCH /appointments/:id/cancel` · `PATCH /appointments/:id/complete` · `PATCH /appointments/:id/no-show` |

Every response uses the same envelope:

```json
{ "status": "success", "message": "...", "data": { } }
```

Full reference: [`docs/api/medical-records.md`](docs/api/medical-records.md) ·
Importable Postman collection: [`docs/postman-collection.json`](docs/postman-collection.json)

## Documentation

Everything is indexed in [`docs/README.md`](docs/README.md):

- **Guides** — [installation](docs/installation-guide.md) · [deployment](docs/deployment-guide.md) · [testing](docs/testing-guide.md)
- **Diagrams** (Mermaid) — [ER](docs/diagrams/er-diagram.md) · [DFD](docs/diagrams/dfd.md) · [class](docs/diagrams/class-diagram.md) · [sequence](docs/diagrams/sequence-diagrams.md) · [component](docs/diagrams/component-diagram.md)
- **Submission** — [IEEE report content](docs/ieee-report-content.md) · [viva question bank](docs/viva-questions.md)
- **Blockchain layer** — [docs/blockchain.md](docs/blockchain.md)

---

## Project status

| Module | Scope | Status |
| --- | --- | --- |
| 1 | Backend foundation, auth, JWT, roles | Complete |
| 2 | Admin doctor verification, user management | Complete |
| 3 | Medical records, encryption, IPFS | Complete |
| 4 | Smart contract, Hardhat, ethers.js | Complete |
| 5 | Record sharing, grant/revoke, chain history | Complete |
| 6 | Doctor workflows, diagnosis, prescriptions | Complete |
| 6b | Appointments | Complete |
| 7 | React foundation | Complete |
| 8–10 | Patient / doctor / admin dashboards | Complete |
| 11 | Hardening, documentation, deployment | Complete |

**All 11 modules delivered.** 144 automated tests: 32 unit, 74 API integration,
38 smart contract.

Detailed task breakdown: [`PROJECT_TODO.md`](PROJECT_TODO.md)

---

## Testing

```bash
cd backend     && npm run test:unit          # 32 — no services needed
cd backend     && npm run test:integration   # 74 — needs API + DB running
cd backend     && npm run test:all           # 106
cd blockchain  && npx hardhat test           # 38 — spins up its own chain
cd backend     && npm run lint               # currently clean
```

The Module 3 suite covers authentication, the MIME allow-list, encryption at
rest, duplicate rejection, owner scoping, cross-patient denial, admin plaintext
denial, byte-identical round-trip, tamper detection and soft delete.

---

## License

MIT
