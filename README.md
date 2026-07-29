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

### 3. Run the tests

With the API running, in a second terminal:

```bash
cd backend
npm run test:integration
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
| Records | `POST /records` · `GET /records` · `GET /records/:id` · `GET /records/:id/download` · `GET /records/:id/verify` · `PATCH /records/:id` · `DELETE /records/:id` |

Every response uses the same envelope:

```json
{ "status": "success", "message": "...", "data": { } }
```

Full reference: [`docs/api/medical-records.md`](docs/api/medical-records.md)

---

## Project status

| Module | Scope | Status |
| --- | --- | --- |
| 1 | Backend foundation, auth, JWT, roles | Complete |
| 2 | Admin doctor verification, user management | Complete |
| 3 | Medical records, encryption, IPFS | Complete |
| 4 | Smart contract, Hardhat, ethers.js | In progress |
| 5 | Record sharing, grant/revoke, chain history | Pending |
| 6 | Doctor workflows, diagnosis, prescriptions | Pending |
| 7 | React foundation | Pending |
| 8–10 | Patient / doctor / admin dashboards | Pending |
| 11 | Hardening, documentation, deployment | Pending |

Detailed task breakdown: [`PROJECT_TODO.md`](PROJECT_TODO.md)

---

## Testing

```bash
cd backend && npm run test:integration    # API integration tests
cd blockchain && npx hardhat test         # smart contract tests
```

The Module 3 suite covers authentication, the MIME allow-list, encryption at
rest, duplicate rejection, owner scoping, cross-patient denial, admin plaintext
denial, byte-identical round-trip, tamper detection and soft delete.

---

## License

MIT
