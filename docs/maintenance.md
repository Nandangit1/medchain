# Keeping MedChain running

This guide is for whoever looks after the live site, with or without coding
experience. Each problem below has a symptom, a cause and a fix, and most fixes
are a setting change in the Render dashboard rather than a code change.

Live site: https://medchain-y4k0.onrender.com

---

## 1. What already looks after itself

| Job | What it does | Where it lives |
| --- | --- | --- |
| Keep awake | The server pings itself every 10 minutes so Render never puts it to sleep. A GitHub Action pings it too, as a backup. | `backend/src/server.js`, `.github/workflows/keep-alive.yml` |
| Blockchain sync | Every new upload, share and revoke is written to the Sepolia blockchain within about a minute. Anything that fails is retried with growing gaps (3 min, 6, 12 … up to 12 h) for days. | `backend/src/services/chainSyncService.js` |
| Missed receipts | If a transaction landed but the server missed the confirmation, the record is recovered from the chain. It does not get stuck at "Failed". | `blockchainService.findExistingAnchor` |
| Telegram | The bot's webhook is registered again every time the server starts. | `backend/src/services/telegramService.js` |
| Admin account | Created automatically on first boot if it is missing. | `SEED_ADMIN_ON_BOOT` |

---

## 2. A two-minute monthly check

Open **https://medchain-y4k0.onrender.com/api/v1/health** in a browser. You
should see:

```
"database": "connected"
"blockchain": { "enabled": true, "connected": true, ..., "lowBalance": false }
```

- `database` is not `connected`: see **Database** below.
- `connected: false` under blockchain: see **Records stay "Pending"**.
- `lowBalance: true`: top up the wallet (see **Out of test ETH**).

Then sign in as a patient and confirm the newest record says **Confirmed**.

---

## 3. Problems and fixes

### The site takes 30–60 seconds to open

Render's free tier sleeps after 15 idle minutes. The self-ping should prevent
it. If it still happens:

1. Render → **medchain** → **Environment**: make sure `KEEP_AWAKE` is **not**
   set to `false`.
2. GitHub → repository → **Actions** → *Keep site awake*. If GitHub paused it
   (it does so after 60 days with no commits), click **Enable workflow**.
3. Extra safety (free, 3 minutes): create a monitor at **uptimerobot.com**
   (HTTP, every 5 minutes) on `https://medchain-y4k0.onrender.com/api/v1/health`.

Render gives 750 free hours a month, which is enough for **one** always-on
service. A second free service would split those hours and both would sleep.

### Records stay "Pending" or turn "Failed"

1. Open `/api/v1/health`.
   - `"lowBalance": true`: see **Out of test ETH**.
   - `"connected": false`: the RPC server (the computer the site uses to
     reach Sepolia) is down. In Render → Environment, change
     `BLOCKCHAIN_RPC_URL` to another free Sepolia RPC:
     - `https://ethereum-sepolia-rpc.publicnode.com` (current)
     - `https://sepolia.drpc.org`
     - or a free key from alchemy.com / infura.io (most reliable)
2. Render → **Manual Deploy** → **Restart service**. On every start the server
   gives "Failed" items a fresh set of retries, and the sync runs 20 seconds
   later.
3. Render → **Logs**: search for `Anchoring failed` to see the reason.

Uploads are never lost. A record that is not on-chain yet is still encrypted,
stored and usable. Only its blockchain badge waits.

### Out of test ETH (`lowBalance: true`)

The wallet that pays for blockchain writes is
`0x37C561cB5AcF37fc1346F35d5E675A8f63e4AdE1`. Sepolia ETH is free test money:

- https://sepolia-faucet.pk910.de: paste the address, **Start Mining**, then
  claim after about 20 minutes. No account needed.
- https://cloud.google.com/application/web3/faucet/ethereum/sepolia: sign in with Google.

Then restart the service (see above) so stalled records retry straight away.

### Password reset emails stop arriving

1. Check spam first.
2. Render → Logs, search `Brevo rejected`:
   - "sender not verified": in Brevo → Senders, the address in `MAIL_FROM`
     must show **Verified**.
   - "unauthorized" / "key not found": generate a new key in Brevo
     (SMTP & API → API Keys, Transactional email = All) and update
     `BREVO_API_KEY`.
3. Emergency access: when mail fails, each code is written to the Render log.
   Search `Password reset code was not emailed`.

Brevo's free plan sends 300 emails a day.

### Telegram messages stop

1. Render → Logs, search `Telegram`.
   - `Telegram start-up failed` / `401`: the token was revoked. Get a new one
     from @BotFather (`/token`) and update `TELEGRAM_BOT_TOKEN`.
2. A user who blocked the bot is disconnected automatically. They reconnect
   from **Profile → Connect Telegram**.

### Uploads fail

Files are stored on IPFS through **Pinata**. Its free plan has storage and
file-count limits. Log in at pinata.cloud and check usage; delete test files
or upgrade. If the `PINATA_JWT` key was revoked, create a new one and update
it on Render.

### Nobody can sign in / the database is down

MongoDB Atlas (cloud.mongodb.com):

1. If the cluster says **Paused**, click **Resume**.
2. **Network Access** must still list `0.0.0.0/0`, because Render has no fixed IP.
3. If the database password was changed, update `MONGODB_URI` on Render.

### A deploy (build) fails on Render

Render → **Events** → open the failed deploy to read the log. Node is pinned
to version 24 by `.node-version`, so Render will not switch versions on its
own. If a build fails after a code change, roll back with **Events → the last
good deploy → Rollback**.

### Sepolia is shut down one day

Test networks are retired eventually. Records stay safe in the database. A
developer would deploy the contract to the replacement testnet
(`cd blockchain && npx hardhat run scripts/deploy.js --network <new>`),
update `CONTRACT_ADDRESS`, `BLOCKCHAIN_RPC_URL` and `BLOCKCHAIN_CHAIN_ID` on
Render, and run `npm run backfill:anchors -- --reset` once against the
database so every record is anchored again.

---

## 4. Accounts the site depends on

| Service | Used for | Setting(s) on Render |
| --- | --- | --- |
| Render | Hosting | — |
| MongoDB Atlas | Database | `MONGODB_URI` |
| Pinata | Encrypted file storage (IPFS) | `PINATA_JWT`, `PINATA_GATEWAY_URL` |
| Brevo | Password reset emails | `BREVO_API_KEY`, `MAIL_FROM` |
| Telegram @BotFather | Report messages | `TELEGRAM_BOT_TOKEN` |
| Sepolia wallet | Blockchain writes | `REGISTRAR_PRIVATE_KEY`, `CONTRACT_ADDRESS`, `BLOCKCHAIN_RPC_URL` |
| GitHub | Code, deploys, backup keep-alive | — |
| Google Cloud (optional) | Full Maps view with store list | `GOOGLE_MAPS_API_KEY` |

## 5. Secrets to back up somewhere outside the project folder

Losing these cannot be fixed by code:

- `FILE_ENCRYPTION_KEY`: without it every stored record is unreadable, forever.
- `CUSTODIAL_WALLET_SEED`: changing it disconnects every user's on-chain identity.
- `blockchain/.env` (the deployer private key): controls the contract.
- `JWT_SECRET`: changing it signs everyone out (harmless, but surprising).

## 6. Blockchain facts for reports

- Network: Ethereum **Sepolia** testnet (chain id 11155111)
- Contract: `0x0A5169B96bA16a642E9904309239e2AA2e2e4178`.
  View it at https://sepolia.etherscan.io/address/0x0A5169B96bA16a642E9904309239e2AA2e2e4178
- Each record's anchor transaction is on its **Record details** page, and
  **Verify integrity** checks the file against the hash stored on-chain.
