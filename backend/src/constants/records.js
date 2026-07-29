const RECORD_TYPES = Object.freeze({
  LAB_REPORT: "lab_report",
  PRESCRIPTION: "prescription",
  DIAGNOSIS: "diagnosis",
  IMAGING: "imaging",
  DISCHARGE_SUMMARY: "discharge_summary",
  VACCINATION: "vaccination",
  INSURANCE: "insurance",
  OTHER: "other",
});

/**
 * Numeric mirror of RECORD_TYPES for the smart contract, which stores the type
 * as a uint8 to keep gas down.
 *
 * These codes are PERMANENT. A value written on-chain can never be changed, so
 * new record types must be appended with a new number — never renumbered, and
 * never reused.
 */
const RECORD_TYPE_CODES = Object.freeze({
  [RECORD_TYPES.LAB_REPORT]: 1,
  [RECORD_TYPES.PRESCRIPTION]: 2,
  [RECORD_TYPES.DIAGNOSIS]: 3,
  [RECORD_TYPES.IMAGING]: 4,
  [RECORD_TYPES.DISCHARGE_SUMMARY]: 5,
  [RECORD_TYPES.VACCINATION]: 6,
  [RECORD_TYPES.INSURANCE]: 7,
  [RECORD_TYPES.OTHER]: 99,
});

const RECORD_STATUS = Object.freeze({
  ACTIVE: "active",
  ARCHIVED: "archived",
});

/**
 * Blockchain anchoring is performed in Module 4. Until the contract is
 * deployed every record is persisted with a PENDING anchor so that no
 * historical data needs to be back-filled once anchoring goes live.
 */
const BLOCKCHAIN_SYNC_STATUS = Object.freeze({
  PENDING: "pending",
  CONFIRMED: "confirmed",
  FAILED: "failed",
});

const IPFS_DRIVERS = Object.freeze({
  LOCAL: "local",
  PINATA: "pinata",
});

/**
 * Allow-list rather than a deny-list: an examiner should be able to see that
 * an arbitrary executable can never reach storage.
 */
const ALLOWED_MIME_TYPES = Object.freeze({
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/tiff": "tiff",
  "application/dicom": "dcm",
  "text/plain": "txt",
});

/** On-chain transaction categories, used by the BlockchainTransaction log. */
const CHAIN_TX_TYPES = Object.freeze({
  REGISTER_PATIENT: "register_patient",
  REGISTER_DOCTOR: "register_doctor",
  VERIFY_DOCTOR: "verify_doctor",
  ANCHOR_RECORD: "anchor_record",
  DEACTIVATE_RECORD: "deactivate_record",
  GRANT_ACCESS: "grant_access",
  REVOKE_ACCESS: "revoke_access",
  LOG_ACCESS: "log_access",
});

const WALLET_TYPES = Object.freeze({
  CUSTODIAL: "custodial",
  EXTERNAL: "external",
});

module.exports = {
  ALLOWED_MIME_TYPES,
  BLOCKCHAIN_SYNC_STATUS,
  CHAIN_TX_TYPES,
  IPFS_DRIVERS,
  RECORD_STATUS,
  RECORD_TYPE_CODES,
  RECORD_TYPES,
  WALLET_TYPES,
};
