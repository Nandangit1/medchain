# Medical Records API — Module 3

Base path: `/api/v1/records`
All endpoints require `Authorization: Bearer <token>`.

## Access model (as of Module 3)

| Capability | Patient (owner) | Admin | Doctor |
| --- | --- | --- | --- |
| Upload record | Yes | No | Module 6 |
| List / view metadata | Own only | All | Module 5 |
| Download plaintext file | Yes | **No** | Module 5 |
| Verify integrity | Yes | Yes | Module 5 |
| Update metadata | Yes | No | No |
| Delete (soft) | Yes | No | No |

Administrators are deliberately denied plaintext. An operator needs to run the
platform, not read a patient's pathology report. Doctor access is granted
per-record by the patient in Module 5 and enforced on-chain.

---

## `POST /api/v1/records`

Uploads, encrypts and pins a medical report. **Role: patient.**

`Content-Type: multipart/form-data`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `file` | file | Yes | pdf, png, jpeg, webp, tiff, dicom, txt. Max `MAX_UPLOAD_SIZE_MB` (default 10 MB). |
| `title` | string | Yes | 3–140 characters. |
| `recordType` | string | Yes | `lab_report`, `prescription`, `diagnosis`, `imaging`, `discharge_summary`, `vaccination`, `insurance`, `other`. |
| `description` | string | No | Up to 1000 characters. |
| `recordDate` | ISO 8601 | No | Defaults to now. Cannot be in the future. |
| `tags` | string / repeated | No | Comma-separated or repeated. Max 10 tags, 30 chars each. |

### Pipeline

```
plaintext buffer
  -> sha256(plaintext)            <- the integrity anchor, stored and later put on-chain
  -> reject if the patient already has this hash (409)
  -> AES-256-GCM with a fresh random content key
  -> content key wrapped with FILE_ENCRYPTION_KEY
  -> ciphertext pinned to IPFS    -> CID
  -> metadata + envelope persisted to MongoDB
```

If the database write fails after pinning, the CID is unpinned as a
compensating action so no orphaned blob is left behind.

### `201 Created`

```json
{
  "status": "success",
  "message": "Medical record uploaded and pinned successfully.",
  "data": {
    "record": {
      "_id": "68f1...",
      "patient": "68f0...",
      "title": "Complete Blood Count",
      "recordType": "lab_report",
      "tags": ["blood", "routine"],
      "file": { "originalName": "report.pdf", "mimeType": "application/pdf", "extension": "pdf", "size": 96 },
      "storage": { "provider": "local", "cid": "bafkrei...", "encryptedSize": 112 },
      "integrity": { "algorithm": "sha256", "fileHash": "9f86d0..." },
      "blockchain": { "status": "pending" },
      "status": "active"
    }
  }
}
```

The `encryption` envelope is `select: false` in the schema and is stripped by
`toClientObject()`. It is never returned by any endpoint.

### Errors

| Status | Cause |
| --- | --- |
| 400 | Missing/invalid metadata, or no file supplied |
| 401 | Missing or invalid token |
| 403 | Non-patient role, or inactive account |
| 409 | Byte-identical file already exists for this patient |
| 413 | File exceeds the size limit |
| 415 | MIME type not in the allow-list |

---

## `GET /api/v1/records`

Lists records. **Roles: patient (own only), admin (all).**

Query: `page`, `limit` (max 100), `search`, `recordType`, `status`,
`blockchainStatus`, `from`, `to`, `patientId` (admin only — a patient is
hard-scoped to their own data server-side, so supplying it has no effect).

Returns `{ records: [...], pagination: { totalItems, totalPages, currentPage, limit, hasNextPage, hasPreviousPage } }`.

---

## `GET /api/v1/records/:recordId`

Single record metadata. **Roles: owner, admin.** `404` if not found or soft-deleted, `403` if it belongs to someone else.

---

## `GET /api/v1/records/:recordId/download`

Fetches the ciphertext from IPFS, decrypts it, re-verifies the SHA-256 digest
against the stored hash, and streams the plaintext. **Role: owner only.**

Returns the raw file — not the JSON envelope — with `Content-Type` set to the
original MIME type, `Content-Disposition: attachment`, `Cache-Control: no-store`
and an `X-Record-Integrity-Hash` header.

`422` if the GCM auth tag fails or the digest does not match: a tampered file is
never served.

---

## `GET /api/v1/records/:recordId/verify`

Non-destructive integrity audit. **Roles: owner, admin.** Returns a verdict
rather than the file, so it is safe to expose to an auditor.

```json
{
  "report": {
    "recordId": "68f1...",
    "cid": "bafkrei...",
    "provider": "local",
    "algorithm": "sha256",
    "expectedHash": "9f86d0...",
    "actualHash": "9f86d0...",
    "retrievable": true,
    "authentic": true,
    "integrityVerified": true,
    "verifiedAt": "2026-07-29T11:20:00.000Z"
  }
}
```

`retrievable: false` means IPFS could not return the content; `authentic: false`
means the ciphertext failed its GCM authentication tag.

---

## `PATCH /api/v1/records/:recordId`

Updates descriptive metadata only: `title`, `description`, `recordType`,
`recordDate`, `tags`, `status`. **Role: owner.**

The file, its hash, its CID and its encryption envelope are immutable —
replacing a document means uploading a new record, which is what preserves the
audit trail.

---

## `DELETE /api/v1/records/:recordId`

Soft delete. **Role: owner.** The metadata row and its blockchain anchor are
retained so the audit trail stays complete; only the encrypted blob is unpinned,
making the content unrecoverable without destroying the evidence that it
existed. Returns `{ recordId, unpinnedFromIpfs }`.

---

## Configuration

```ini
FILE_ENCRYPTION_KEY=<64 hex chars>     # required; wraps every per-file key
IPFS_DRIVER=local                      # local | pinata
LOCAL_IPFS_PATH=./.local/ipfs
PINATA_JWT=                            # required when IPFS_DRIVER=pinata
PINATA_API_URL=https://api.pinata.cloud
PINATA_GATEWAY_URL=https://gateway.pinata.cloud
MAX_UPLOAD_SIZE_MB=10
```

Generate the master key with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Losing `FILE_ENCRYPTION_KEY` makes every stored record permanently unreadable.
It must be backed up and must differ per environment.

### Switching to real IPFS

Set `IPFS_DRIVER=pinata` and `PINATA_JWT=<token>`, then restart. No application
code changes — the factory in `src/services/ipfs/index.js` resolves the driver
at startup. Records pinned under the local driver keep their old CIDs and will
no longer resolve, so switch drivers before loading demonstration data.

---

## Testing

```bash
npm run dev              # terminal 1 (MongoDB must be running)
npm run seed:admin       # once
npm run test:integration # terminal 2
```

15 black-box API tests cover authentication, the MIME allow-list, encryption at
rest, duplicate rejection, owner scoping, cross-patient denial, admin plaintext
denial, byte-identical round-trip, tamper detection and soft delete.
