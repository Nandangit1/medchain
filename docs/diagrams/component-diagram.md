# Component & Deployment Diagrams

## Component diagram

```mermaid
flowchart TB
    subgraph BROWSER["Browser"]
        subgraph FE["React SPA :3000"]
            RT["Router + role guards"]
            AC["AuthContext"]
            AX["Axios client
            single-flight refresh"]
            PG["Pages
            patient / doctor / admin"]
            CP["Shared components
            ShareModal, NotificationBell"]
        end
        MM["MetaMask
        optional external wallet"]
    end

    subgraph SERVER["Node.js :5000"]
        subgraph MWL["Middleware"]
            HEL["helmet · cors · compression"]
            RL["rate limiters"]
            SAN["mongo-sanitize · hpp"]
            CK["cookie-parser"]
            AUTH["protect · authorize
            requireVerifiedDoctor"]
            MUL["multer memoryStorage"]
            ERR["global error handler"]
        end

        subgraph RTS["Routes"]
            R1["/auth"]
            R2["/records"]
            R3["/patients"]
            R4["/doctors"]
            R5["/appointments"]
            R6["/notifications"]
            R7["/admin"]
            R8["/health"]
        end

        subgraph SVCS["Services"]
            S1["medicalRecord"]
            S2["accessControl"]
            S3["encryption"]
            S4["ipfs (factory)"]
            S5["blockchain"]
            S6["token"]
            S7["audit"]
            S8["notification"]
            S9["admin / doctor / patient"]
        end

        subgraph REPOS["Repositories"]
            RP1["medicalRecord"]
            RP2["accessPermission"]
            RP3["appointment"]
            RP4["diagnosis"]
            RP5["user"]
        end

        LOG["Winston
        rotating logs + redaction"]
    end

    subgraph EXT["External"]
        MDB[("MongoDB :27017")]
        LOCAL[("Local IPFS
        .local/ipfs")]
        PIN[("Pinata
        api.pinata.cloud")]
        NODE[("Ethereum JSON-RPC
        Hardhat :8545 or Sepolia")]
    end

    PG --> AX
    AC --> AX
    RT --> PG
    CP --> AX
    AX -->|"REST + httpOnly cookie"| MWL
    MM -.->|"patient-signed grants"| NODE

    MWL --> RTS
    RTS --> SVCS
    SVCS --> REPOS
    REPOS --> MDB
    SVCS --> LOG

    S4 -->|"IPFS_DRIVER=local"| LOCAL
    S4 -->|"IPFS_DRIVER=pinata"| PIN
    S5 -->|ethers v6| NODE
```

### Interfaces between components

| From | To | Contract |
| --- | --- | --- |
| React | Express | REST/JSON, `{status, message, data}`; Bearer header + httpOnly refresh cookie |
| Controller | Service | plain objects — no `req`/`res` beyond audit context |
| Service | Repository | intent methods; no Mongoose query syntax crosses the boundary |
| Service | IpfsService | `upload` / `fetchByCid` / `unpin` — provider-agnostic |
| BlockchainService | Contract | ABI from `deploy.js`, serialised nonce queue |
| MetaMask | Contract | direct `grantAccess` for patients with a linked wallet |

## Deployment diagram — development

```mermaid
flowchart LR
    subgraph DEV["Developer workstation (Windows)"]
        V["Vite dev server
        :3000"]
        N["Node/Express + nodemon
        :5000"]
        M[("mongod
        :27017
        .local/mongodb/data")]
        H["Hardhat node
        :8545
        20 funded accounts"]
        F[("Local IPFS
        .local/ipfs
        content-addressed")]
    end

    V -->|"CORS_ORIGIN must match"| N
    N --> M
    N -->|"JSON-RPC"| H
    N --> F
```

Everything runs on one machine with **no third-party credentials**: the local
IPFS driver and Hardhat's in-memory chain stand in for Pinata and Ethereum.

## Deployment diagram — production

```mermaid
flowchart TB
    subgraph EDGE["Edge"]
        CDN["Static host / CDN
        React build output"]
        LB["HTTPS reverse proxy
        TLS termination"]
    end

    subgraph APP["Application tier"]
        API1["Node process 1"]
        API2["Node process 2"]
    end

    subgraph DATA["Data tier"]
        ATLAS[("MongoDB Atlas
        replica set, encrypted at rest")]
        VAULT[["Secret manager
        FILE_ENCRYPTION_KEY
        CUSTODIAL_WALLET_SEED
        REGISTRAR_PRIVATE_KEY"]]
    end

    subgraph THIRD["Third party"]
        PINP[("Pinata
        IPFS pinning")]
        RPC[("Sepolia RPC
        Infura / Alchemy")]
    end

    USER([User]) --> CDN
    USER --> LB
    LB --> API1
    LB --> API2
    API1 --> ATLAS
    API2 --> ATLAS
    API1 --> PINP
    API1 --> RPC
    API1 -.->|"at boot"| VAULT
    API2 -.->|"at boot"| VAULT
```

### What must change before this is production-safe

- **Secrets leave `.env`.** `FILE_ENCRYPTION_KEY`, `CUSTODIAL_WALLET_SEED` and
  `REGISTRAR_PRIVATE_KEY` belong in a managed secret store. Losing the first
  makes every record unreadable; losing the third lets an attacker anchor and
  grant at will.
- **`BLOCKCHAIN_CONFIRMATIONS` above 1.** A public chain can reorg; one
  confirmation does not protect against that.
- **`CUSTODIAN_ROLE` revoked** once patients hold their own wallets, so grants
  are genuinely patient-signed.
- **Horizontal scaling caveat.** `blockchainService` serialises transactions
  behind an *in-process* nonce counter. Two Node processes sharing one registrar
  key would collide. Either give each process its own key, or move anchoring to
  a single-consumer queue.
- **Rate limiting shared.** `express-rate-limit` defaults to in-memory counters,
  which are per-process. Back it with Redis so limits apply across instances.
- **`secure: true` cookies** — already conditional on `NODE_ENV=production`, so
  TLS is mandatory.
