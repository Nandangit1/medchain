# Installation Guide

Target: a clean Windows 10/11 machine. Linux and macOS differ only in the
MongoDB start command.

## 1. Prerequisites

| Tool | Version | Check | Source |
| --- | --- | --- | --- |
| Node.js | ≥ 18.18 (20 LTS+ recommended) | `node -v` | nodejs.org |
| npm | ≥ 9 | `npm -v` | ships with Node |
| Git | any | `git --version` | git-scm.com |
| MongoDB | 6+ | see step 2 | bundled under `.local/mongodb` |
| MetaMask | latest | browser extension | metamask.io (optional) |

On Windows, Git can be installed non-interactively:

```powershell
winget install --id Git.Git -e --source winget
```

Open a **new** terminal afterwards so `git` is on `PATH`.

## 2. Start MongoDB

A portable MongoDB ships in the repository. Create its data directory once:

```powershell
New-Item -ItemType Directory -Force -Path .local\mongodb\data
```

Then start it (leave this terminal running):

```powershell
.local\mongodb\mongodb-win32-x86_64-windows-8.3.4\bin\mongod.exe `
  --dbpath .local\mongodb\data --port 27017 --logpath .local\mongodb\mongod.log
```

Linux/macOS with a system MongoDB:

```bash
mkdir -p .local/mongodb/data
mongod --dbpath .local/mongodb/data --port 27017
```

Confirm it is listening: the log should end with
`"Waiting for connections","attr":{"port":27017}`.

## 3. Backend

```bash
cd backend
npm install
```

Create the environment file:

```bash
cp .env.example .env        # Windows: Copy-Item .env.example .env
```

Generate the two secrets and paste them into `.env`:

```bash
node -e "console.log('FILE_ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log('CUSTODIAL_WALLET_SEED=' + require('crypto').randomBytes(32).toString('hex'))"
```

Also set `JWT_SECRET` to at least 32 characters. The server refuses to start if
any of these are missing or malformed — that is deliberate, so a
misconfiguration fails at boot rather than at the first upload.

> **Back both keys up outside the project folder.** `.env` is git-ignored, so
> they exist in exactly one place. Losing `FILE_ENCRYPTION_KEY` makes every
> stored record permanently unreadable.

Seed the administrator, then start the API:

```bash
npm run seed:admin      # first run only
npm run dev             # http://localhost:5000
```

Verify:

```bash
curl http://localhost:5000/api/v1/health
```

`"database": "connected"` means the backend is ready. Blockchain will show
`"enabled": false` until step 4.

## 4. Blockchain (optional, recommended)

Without this the platform runs fully — records are encrypted and stored, and
simply stay at `blockchain.status: "pending"`.

```bash
cd blockchain
npm install
npx hardhat compile
npx hardhat test          # 38 tests should pass
```

Start a local chain (leave running):

```bash
npx hardhat node
```

In another terminal, deploy:

```bash
cd blockchain
npx hardhat run scripts/deploy.js --network localhost
```

The script prints the contract address and writes the address + ABI into
`backend/src/config/contracts/TelemedicineRecords.json`, so no manual copying is
needed. Update `backend/.env`:

```ini
BLOCKCHAIN_ENABLED=true
CONTRACT_ADDRESS=<address printed by the script>
REGISTRAR_PRIVATE_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
```

That key is **Hardhat account #1** — a publicly known test key. Never use it on
a live network.

Restart the backend, then confirm:

```bash
curl http://localhost:5000/api/v1/health
```

You should now see `"blockchain": { "enabled": true, "connected": true, ... }`.

If any records were uploaded before enabling the chain:

```bash
cd backend
npm run backfill:anchors
```

## 5. Frontend

```bash
cd frontend
npm install
cp .env.example .env
npm run dev             # http://localhost
```

The dev server runs on port **80** and proxies `/api` to the Express backend, so
the whole app is served from a single origin. That is why `VITE_API_URL` is
relative (`/api/v1`): there are no CORS preflights, the httpOnly refresh cookie
works without special cases, and the same build runs on any hostname.

Open http://localhost and sign in as the seeded admin
(`admin@example.com` / `Admin@12345`), or register a patient.

### Optional: use http://medchain.local instead of localhost

To give the app a real hostname, map `medchain.local` to this machine:

```powershell
# Right-click PowerShell -> Run as Administrator
powershell -ExecutionPolicy Bypass -File scripts\setup-hostname.ps1
```

The script backs up the hosts file, adds two loopback entries, and flushes the
DNS cache. Nothing is sent to the internet — the hosts file is simply consulted
before DNS. Undo it at any time:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup-hostname.ps1 -Remove
```

Then open **http://medchain.local**.

> Type the full URL including `http://`. Some browsers treat a bare hostname
> with no `.com` as a search query and will show search results instead.

`localhost` keeps working either way — both hostnames are in the Vite
`allowedHosts` list and the backend `CORS_ORIGIN`.

## 6. Verify the whole stack

```bash
cd backend && npm run test:integration    # 74 tests
cd blockchain && npx hardhat test         # 38 tests
```

## Running order summary

Five terminals, in this order:

| # | Directory | Command | Port |
| --- | --- | --- | --- |
| 1 | root | `mongod --dbpath .local/mongodb/data` | 27017 |
| 2 | `blockchain` | `npx hardhat node` | 8545 |
| 3 | `blockchain` | `npx hardhat run scripts/deploy.js --network localhost` | — |
| 4 | `backend` | `npm run dev` | 5000 |
| 5 | `frontend` | `npm run dev` | 80 |

Terminal 3 exits after deploying.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Missing required environment variables` | `.env` incomplete | Set `MONGODB_URI`, `JWT_SECRET`, `FILE_ENCRYPTION_KEY` |
| `FILE_ENCRYPTION_KEY must be … 64 hexadecimal characters` | wrong key length | Regenerate with the command in step 3 |
| `EADDRINUSE :::5000` | API already running | Stop the other instance, or change `PORT` |
| `MongooseServerSelectionError` | MongoDB not running | Start terminal 1 |
| CORS error in the browser console | frontend origin not allow-listed | Add it to `CORS_ORIGIN` (comma-separated) |
| `EADDRINUSE :::80` | IIS, Skype or another server holds port 80 | Stop it, or change `server.port` in `vite.config.js` |
| `medchain.local` shows search results | browser treated it as a query | Type the full `http://medchain.local` |
| `medchain.local` does not resolve | hosts entry missing | Run `scripts\setup-hostname.ps1` as Administrator |
| `Blocked request. This host is not allowed` | hostname not in `allowedHosts` | Add it to `server.allowedHosts` in `vite.config.js` |
| `Contract artifact not found` | never deployed | Run the deploy script (step 4) |
| `nonce has already been used` | stale nonce after a chain restart | Restart the backend; it re-reads the nonce |
| Records stuck at `pending` | chain disabled or unreachable | Enable it, then `npm run backfill:anchors` |
| Anchors point at a dead contract | contract redeployed | `npm run backfill:anchors -- --reset` |
| `.env` changes ignored | nodemon watches only `src` | Restart the backend manually |
