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
| `MAIL_ENABLED=false` | reset links go to logs | SMTP credentials, then set it true |
| `ABHA_DRIVER=mock` | no identity is really verified | Registered ABDM sandbox client |
| `SCRIBE_DRIVER=mock` | draft notes are extractive, not generated | `claude` plus `ANTHROPIC_API_KEY` |
| Single-contributor ZK setup | demo-grade trusted setup | Multi-party phase 2 ceremony |
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

6. Build the indexes. Point the script at the cluster and run it once — it reads
   every index off the Mongoose schemas, so it cannot drift from what the
   application actually queries through:

```bash
cd backend
MONGODB_URI="mongodb+srv://..." npm run ensure:indexes
```

It prints one line per collection and only ever adds; an index you created by
hand for an ad-hoc report is left alone.

> A hand-maintained list is what this replaces, and the reason is worth
> recording. The list previously printed here specified the doctor-licence
> index with **both** `sparse` and `partialFilterExpression`. MongoDB refuses
> that combination outright (error 67, "cannot mix"), so that index had never
> been created in any database — and the uniqueness it claimed to enforce was
> not being enforced at all. The schema now carries the `$type` clause that
> `sparse` was reaching for.

Three of these indexes are load-bearing rather than merely fast:

| Index | Without it |
| --- | --- |
| `accesspermissions { record, doctor }` unique on non-revoked rows | re-granting a previously revoked doctor fails on a duplicate key |
| `appointments { doctor, scheduledFor }` unique on live statuses | rebooking a cancelled slot fails the same way |
| `users { doctorProfile.medicalLicenseNumber }` unique among doctors | two doctors can register the same licence number |

Each is a **partial** unique. The partial filter is the whole point — a plain
unique index on any of the three breaks the ordinary case.

7. Only once that has run, set `DISABLE_AUTO_INDEX=true` so restarts stop
   re-checking indexes on every boot.

> **`DISABLE_AUTO_INDEX` is the control, not `NODE_ENV`.** Index building is
> keyed off that variable alone (`config/database.js`), so setting
> `NODE_ENV=production` does *not* switch it off. Leave it `false` for the first
> deploy: a fresh database with index building disabled is one that accepts
> duplicate registrations.

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

## 4b. The short path — Render blueprint

`render.yaml` in the repository root describes the whole service, so Render can
provision it without any of the manual server work in sections 5–7. This is the
route to take for a demo or a viva; sections 5–7 describe running it on your own
infrastructure instead.

**What you must do yourself** — these need your accounts, and nobody can do them
on your behalf:

1. Push to GitHub (already done: `github.com/Nandangit1/medchain`).
2. Create a free MongoDB Atlas cluster. Under **Network Access** allow
   `0.0.0.0/0` — Render's free tier has no static egress IP, so an allow-list
   cannot be narrowed here. Compensate with a strong database password and a
   user scoped to `readWrite` on one database.
3. Create a Pinata account and an API key with `pinFileToIPFS` and `unpin`.
4. On render.com: **New → Blueprint**, select the repository, and fill in the
   values marked `sync: false` when prompted:

```
MONGODB_URI          from Atlas
JWT_SECRET           node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
FILE_ENCRYPTION_KEY  same command — back this up outside the platform
CUSTODIAL_WALLET_SEED same command
ADMIN_EMAIL          the account you will sign in as
ADMIN_PASSWORD       a real password, not the one in the repository
PINATA_JWT           from Pinata
PINATA_GATEWAY_URL   your dedicated gateway
```

The wizard also asks for `BLOCKCHAIN_RPC_URL`, `CONTRACT_ADDRESS` and
`REGISTRAR_PRIVATE_KEY`. Leave them blank for now — `BLOCKCHAIN_ENABLED` is
`false` in the blueprint, so nothing reads them until you have a contract on a
public testnet (section 4).

Everything else has a working offline default and is deliberately **not**
declared in the blueprint, because each `sync: false` key becomes another
question the wizard asks before a first deploy. Add these in the Render
dashboard if and when you want the feature:

| Feature | Add | And set |
| --- | --- | --- |
| Real email | `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` | `MAIL_ENABLED=true` |
| Real ABHA identity | `ABDM_CLIENT_ID`, `ABDM_CLIENT_SECRET` | `ABHA_DRIVER=nha` |
| Model-generated notes | `ANTHROPIC_API_KEY` | `SCRIBE_DRIVER=claude` |

5. Deploy. The blueprint sets `branch: master`, and the health check at
   `/api/v1/health` gates the release.

**What happens automatically**, and why the blueprint is written this way:

- `SEED_ADMIN_ON_BOOT=true` creates the administrator during startup. The free
  plan has no pre-deploy command and no shell, so startup is the only place it
  can happen — and registration only ever mints patients and doctors, so
  without it the site would come up with no way in. The seed is idempotent and
  never touches an existing account's password, so redeploying does not reset
  your credentials.
- `DISABLE_AUTO_INDEX=false` for the first deploy, so the fresh Atlas database
  gets its indexes — including the three partial uniques in section 2. Once
  `npm run ensure:indexes` has been run against the cluster, flip it to `true`.
- `CORS_ORIGIN` and `APP_URL` are both filled from `RENDER_EXTERNAL_URL`, so
  the public origin is never hardcoded and reset links point at the right host.
- `TRUST_TLS=true`, correct here because Render terminates TLS.

**Free-tier caveats**, worth knowing before an examiner sees them:

- The instance sleeps after ~15 minutes idle; the next request takes 30–60
  seconds. Say so rather than letting it look broken.
- The filesystem is ephemeral, which is why `IPFS_DRIVER=pinata` is not
  optional there — the local driver would lose every file on each restart.
- With `MAIL_ENABLED=false`, password-reset links appear in the Render log
  stream rather than an inbox. That is recoverable, just not self-service.

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

The refresh cookie is issued with `secure: env.TRUST_TLS`
(`services/tokenService.js`), so **over plain HTTP with `TRUST_TLS=true` the
browser drops the cookie and sessions will not persist.**

`TRUST_TLS` defaults to true when `NODE_ENV=production`, but it is a separate
switch and the two do come apart in practice — `start:site` runs
`NODE_ENV=production` with `TRUST_TLS=false` on purpose, because a LAN demo on
port 80 has no certificate. Set it to match reality, not the build mode:

| Deployment | `TRUST_TLS` |
| --- | --- |
| Behind Render, nginx, or any TLS terminator | `true` |
| LAN or localhost demo over plain http | `false` |

It controls one more thing besides the cookie flag: whether the CSP asks the
browser to upgrade requests to https, which breaks a site served over http.

The API and frontend should share a parent domain, or the `SameSite=Strict`
cookie will not be sent. If they must be on unrelated domains, `SameSite=None`
plus explicit CSRF tokens is required — a real change, not a config tweak.

---

## 8. Post-deployment checklist

```bash
curl https://api.medchain.example.com/api/v1/health
```

Expect `database: connected`, `ipfs.driver: pinata`, `blockchain.connected: true`.

- [ ] Sign in as the administrator. On Render the boot seed creates it; check
      the log for "Seeded the administrator account on boot." If the line reads
      "boot seed failed", the site is up but has no admin — run
      `MONGODB_URI=... npm run seed:admin` locally against the same cluster.
- [ ] **Change the admin password**, and never deploy with the one in the
      repository.
- [ ] `npm run ensure:indexes` against the cluster, then set
      `DISABLE_AUTO_INDEX=true`.
- [ ] Register a patient, upload a file, confirm `status: confirmed` and a real
      transaction on Etherscan.
- [ ] Verify a doctor, share, download, revoke — confirm 403 after revocation.
- [ ] Try to register a second doctor with an existing licence number; expect a
      duplicate-key rejection. This proves the partial unique index is really
      there, which is the one that was silently missing before.
- [ ] Confirm the audit log records all of it.
- [ ] Confirm a page refresh keeps the session (proves the cookie works over TLS).
- [ ] Enrol MFA for the admin **before** setting `MFA_ENFORCED=true`. Enforcing
      it first locks the deployment out of its own admin account.
- [ ] Request a password reset and confirm the link arrives — in the inbox with
      `MAIL_ENABLED=true`, in the log stream otherwise.
- [ ] Issue a selective-disclosure proof and verify it while signed out. This
      exercises the ZK artefacts under `blockchain/build/`, which ship in git
      precisely so a fresh deploy can do this.
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
