# Documentation Index

## Getting it running

| Document | Purpose |
| --- | --- |
| [installation-guide.md](installation-guide.md) | Clean-machine setup, all five terminals, troubleshooting table |
| [deployment-guide.md](deployment-guide.md) | Atlas, Pinata, Sepolia, TLS, index creation, backup strategy |
| [testing-guide.md](testing-guide.md) | How to run all 144 tests, what each proves, and the honest gaps |

## Reference

| Document | Purpose |
| --- | --- |
| [api/medical-records.md](api/medical-records.md) | Full records API: pipeline, endpoints, error codes |
| [blockchain.md](blockchain.md) | Contract roles, functions, nonce serialisation, graceful degradation |
| [postman-collection.json](postman-collection.json) | Importable collection, including a **Negative tests** folder |

## Diagrams

All in Mermaid, so they render on GitHub and can be exported to PNG/SVG for the
report.

| Document | Contains |
| --- | --- |
| [diagrams/er-diagram.md](diagrams/er-diagram.md) | Logical ER model + schema design decisions |
| [diagrams/dfd.md](diagrams/dfd.md) | DFD levels 0, 1 and 2 (ingestion + authorised retrieval) |
| [diagrams/class-diagram.md](diagrams/class-diagram.md) | Module contracts, models, contract inheritance |
| [diagrams/sequence-diagrams.md](diagrams/sequence-diagrams.md) | Six flows: upload, grant, read, revoke, refresh, verify |
| [diagrams/component-diagram.md](diagrams/component-diagram.md) | Components, interfaces, dev and production deployment |

## For the submission

| Document | Purpose |
| --- | --- |
| [ieee-report-content.md](ieee-report-content.md) | Abstract, literature-survey structure, design maths, results tables, references |
| [viva-questions.md](viva-questions.md) | 40 questions with implementation-grounded answers, plus a rapid-fire table |
| `screenshots/` | Place UI captures here for the report appendix |

## Rendering diagrams for a Word/LaTeX report

GitHub renders Mermaid natively. For the report:

1. Paste a block into [mermaid.live](https://mermaid.live) and export SVG/PNG, or
2. `npm i -g @mermaid-js/mermaid-cli` then
   `mmdc -i diagrams/dfd.md -o dfd.png`

## Reading order for an examiner

1. Root [README.md](../README.md) — what it is and how to run it
2. [diagrams/component-diagram.md](diagrams/component-diagram.md) — the shape of the system
3. [blockchain.md](blockchain.md) — what is and is not on-chain, and why
4. [diagrams/sequence-diagrams.md](diagrams/sequence-diagrams.md) — upload and authorised read
5. [testing-guide.md](testing-guide.md) — the negative tests that validate the design
6. [viva-questions.md](viva-questions.md) — Q31 and Q40 in particular: the defects found, and the honest weaknesses

## Things stated plainly in these docs

Worth knowing before a viva, because each is a question an examiner may ask:

- Encryption is **server-side, not end-to-end** — the server holds the master key
  and sees plaintext in memory. Deliberate trade-off, documented in
  `viva-questions.md` Q10.
- Losing `FILE_ENCRYPTION_KEY` makes every record **permanently unreadable**.
- The MIME allow-list trusts the client's `Content-Type`; magic-byte sniffing
  would be stronger.
- The local IPFS driver's CIDs are valid CIDv1 but differ from Kubo's for files
  over 256 KiB.
- The nonce counter is in-process, so the backend does not yet scale
  horizontally on one registrar key.
- `authController` and `adminController` still call Mongoose directly rather than
  going through repositories — inconsistent with the rest, and recorded as
  outstanding rather than hidden.
