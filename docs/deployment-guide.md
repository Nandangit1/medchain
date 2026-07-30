# Deployment Guide

Moving from the development setup to something that could face real users.
Read `installation-guide.md` first — this document only covers what *changes*.

## 0. What is not production-ready today

State this plainly rather than discovering it under load:

| Item | Status | Required change |
| --- | --- | --- |
| Secrets in `.env` | dev only | Managed secret store |
| `IPFS_DRIVER=local` | dev only | `pinata` with a real JWT |
| Hardhat local chain | dev only | Sepolia or mainnet |
| `BLOCKCHAIN_CONFIRMATIONS=1` | unsafe on public chains | 2+ |
| In-process nonce counter | single instance only | Per-instance key or a queue |
| In-memory rate limiting | per-process | Redis-backed store |
| `CUSTODIAN_ROLE` held by backend | weakens ownership claim | Revoke once wallets exist |
| No mail transport | reset links go to logs | SMTP or a mail API |
| No HTTPS | cookies not `secure` | TLS terminating proxy |

---

## 1. Secrets

Three values must move out of `.env` into a secret manager (AWS Secrets Manager,
Azure Key Vault, HashiCorp Vault, Doppler):

```
FILE_ENCRYPTION_KEY      losing it makes every record permanently unreadable
CUSTODIAL_WALLET_SEED    losing it orphans every user's on-chain identity
REGISTRAR_PRIVATE_KEY    theft lets an attacker anchor and grant at will
JWT_SECRET               theft lets an attacker forge access tokens
```

Rules: a different value per environment, never in git, and **backed up
independently of the database**. A database backup without the encryption key is
useless; the key without the database is also useless. Store them separately.

Generate fresh values for production:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 2. Database — MongoDB Atlas

1. Create a cluster (M10+ for a replica set; M0 free tier has no backups).
2. Create a database user with `readWrite` on `blockchain_telemedicine` only —
   not `atlasAdmin`.
3. Network access: allow-list your application subnet, **not** `0.0.0.0/0`.
4. Enable encryption at rest and automated backups.
5. Connection string:

```ini
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/blockchain_telemedicine?retryWrites=true&w=majority
```

6. Set `NODE_ENV=production`, which disables `autoIndex`. **Build indexes once
   manually** before going live, or the first queries will do full collection
   scans:

```javascript
// mongosh against the production database
db.users.createIndex({ email: 1 }, { unique: true })
db.users.createIndex({ role: 1 })
db.users.createIndex({ "doctorProfile.verificationStatus": 1 })
db.users.createIndex({ "doctorProfile.medicalLicenseNumber": 1 },
  { unique: true, sparse: true, partialFilterExpression: { role: "doctor" } })
db.users.createIndex({ walletAddress: 1 }, { unique: true, sparse: true })

db.medicalrecords.createIndex({ patient: 1, createdAt: -1 })
db.medicalrecords.createIndex({ patient: 1, recordType: 1 })
db.medicalrecords.createIndex({ "integrity.fileHash": 1 })
db.medicalrecords.createIndex({ "storage.cid": 1 })
db.medicalrecords.createIndex({ "blockchain.status": 1 })

db.accesspermissions.createIndex({ record: 1, doctor: 1 },
  { unique: true, partialFilterExpression: { revokedAt: null } })
db.accesspermissions.createIndex({ doctor: 1, revokedAt: 1 })

db.tokens.createIndex({ tokenHash: 1 })
db.tokens.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })

db.notifications.createIndex({ user: 1, readAt: 1, createdAt: -1 })
db.notifications.createIndex({ createdAt: 1 }, { expireAfterSeconds: 7776000 })

db.auditlogs.createIndex({ createdAt: -1 })
db.auditlogs.createIndex({ actor: 1, createdAt: -1 })
db.auditlogs.createIndex({ action: 1 })
db.auditlogs.createIndex({ category: 1 })

db.appointments.createIndex({ doctor: 1, scheduledFor: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ["requested", "confirmed"] } } })
```

Getting the two **partial** unique indexes right matters: without them,
re-granting a revoked doctor and reusing a cancelled appointment slot both fail.

---

## 3. IPFS — Pinata

1. Create a Pinata account and an API key with `pinFileToIPFS` and `unpin`.
2. Set:

```ini
IPFS_DRIVER=pinata
PINATA_JWT=eyJhbGciOi...
PINATA_API_URL=https://api.pinata.cloud
PINATA_GATEWAY_URL=https://your-gateway.mypinata.cloud
```

3. Restart. `GET /api/v1/health` should report `"ipfs": { "driver": "pinata" }`.

> **Switch drivers before loading demonstration data.** CIDs created by the local
> driver will not resolve on the public network. Records pinned locally keep
> their old CIDs and become unretrievable.

A dedicated gateway is worth it — the public `gateway.pinata.cloud` is rate
limited and slow, and every download goes through it.

---

## 4. Blockchain — Sepolia

```bash
cd blockchain
cp .env.example .env
```

```ini
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/<project-id>
DEPLOYER_PRIVATE_KEY=0x<a key that has never held mainnet funds>
ETHERSCAN_API_KEY=<optional, for verification>
```

Fund the deployer from a Sepolia faucet (deployment costs ~2.15M gas). Then:

```bash
npx hardhat run scripts/deploy.js --network sepolia
```

On a live network there is only one configured account, so deployer and registrar
are the same address and the script skips the extra `grantRole`. If you want them
separated — and you should — deploy with an admin key, then grant roles to a
distinct service key:

```javascript
await contract.grantRole(await contract.REGISTRAR_ROLE(), serviceAddress);
await contract.grantRole(await contract.ADMIN_ROLE(), serviceAddress);
// Keep DEFAULT_ADMIN_ROLE on a key that stays offline.
```

Backend config:

```ini
BLOCKCHAIN_ENABLED=true
BLOCKCHAIN_RPC_URL=https://sepolia.infura.io/v3/<project-id>
BLOCKCHAIN_CHAIN_ID=11155111
BLOCKCHAIN_CONFIRMATIONS=2
CONTRACT_ADDRESS=0x...
REGISTRAR_PRIVATE_KEY=0x...
```

**Raise confirmations to at least 2.** A public chain can reorg; a single
confirmation can be undone, which would leave a record marked `confirmed`
pointing at a transaction that no longer exists.

Verify the source publicly:

```bash
npx hardhat verify --network sepolia <address> <adminAddress> <registrarAddress>
```

Then keep the registrar funded — anchoring stops when it runs out of gas, and
records silently accumulate as `pending`. Monitor its balance.

---

## 5. Backend

```bash
cd backend
npm ci --omit=dev
NODE_ENV=production npm start
```

`npm ci` respects the lockfile exactly; `npm install` may resolve differently.

Run under a process manager:

```bash
npm install -g pm2
pm2 start src/server.js --name medchain-api -i 1
pm2 save
pm2 startup
```

> **Keep `-i 1` for now.** Cluster mode would run several processes sharing one
> registrar key, and the nonce counter is in-process — they would collide. Scale
> only after giving each instance its own key or moving anchoring behind a queue.

Set `CORS_ORIGIN` to the deployed frontend origin, exactly, with scheme and no
trailing slash:

```ini
CORS_ORIGIN=https://medchain.example.com
```

---

## 6. Frontend

```bash
cd frontend
echo "VITE_API_URL=https://api.medchain.example.com/api/v1" > .env.production
npm ci
npm run build          # → dist/
```

Serve `dist/` from any static host. It is a single-page app, so **all unknown
paths must fall back to `index.html`** or a refresh on `/patient/records` 404s.

nginx:

```nginx
server {
    listen 443 ssl http2;
    server_name medchain.example.com;

    root /var/www/medchain/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

Hashed asset filenames make the long cache safe; `index.html` must not be cached.

---

## 7. TLS and cookies

The refresh cookie is issued with `secure: true` when `NODE_ENV=production`, so
**without HTTPS the browser will drop it and sessions will not persist.** TLS is
not optional.

The API and frontend should share a parent domain, or the `SameSite=Strict`
cookie will not be sent. If they must be on unrelated domains, `SameSite=None`
plus explicit CSRF tokens is required — a real change, not a config tweak.

---

## 8. Post-deployment checklist

```bash
curl https://api.medchain.example.com/api/v1/health
```

Expect `database: connected`, `ipfs.driver: pinata`, `blockchain.connected: true`.

- [ ] Seed the admin, then **change its password immediately** — the default is
      in the repository.
- [ ] Register a patient, upload a file, confirm `status: confirmed` and a real
      transaction on Etherscan.
- [ ] Verify a doctor, share, download, revoke — confirm 403 after revocation.
- [ ] Confirm the audit log records all of it.
- [ ] Confirm a page refresh keeps the session (proves the cookie works over TLS).
- [ ] `npm run backfill:anchors` returns "nothing to backfill".
- [ ] Revoke `CUSTODIAN_ROLE` if patients hold their own wallets.
- [ ] Set up monitoring: registrar gas balance, `blockchain.status: failed`
      counts, `logs/error-*.log`.

---

## 9. Backup and recovery

Three things must be backed up, and **losing any one of them loses the system**:

1. **MongoDB** — metadata and the wrapped keys. Atlas continuous backups.
2. **`FILE_ENCRYPTION_KEY`** — without it the database is ciphertext with no key.
3. **IPFS pins** — Pinata retains only what you pay for; unpinned content can be
   garbage collected. Consider a second pinning service for redundancy.

The blockchain needs no backup: it is replicated by the network. That is the
point — even if all three of the above were lost, the on-chain hashes would still
prove what existed and when.

Recovery test worth actually running: restore a database snapshot into a staging
environment with the production key, and confirm a record still downloads and
verifies. An untested backup is not a backup.
