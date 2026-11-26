const { env } = require("../config/env");
const logger = require("../config/logger");
const { BLOCKCHAIN_SYNC_STATUS } = require("../constants/records");
const accessPermissionRepository = require("../repositories/accessPermissionRepository");
const medicalRecordRepository = require("../repositories/medicalRecordRepository");
const userRepository = require("../repositories/userRepository");
const blockchainService = require("./blockchainService");

/**
 * Chain Sync Service — keeps MongoDB and the blockchain in step on a public
 * network.
 *
 * WHY IT EXISTS. On a public chain every write waits for blocks (~12 s each,
 * times BLOCKCHAIN_CONFIRMATIONS). Doing that inside an HTTP request made an
 * upload or a share hang for up to a minute. In background mode
 * (env.BLOCKCHAIN_BACKGROUND) the request finishes immediately with status
 * "pending" and the chain work is scheduled here instead.
 *
 * WHAT IT GUARANTEES. A periodic sweep re-drives anything not yet confirmed:
 * records uploaded while the chain was off, a node that was briefly
 * unreachable, a grant made before its record was anchored. That replaces the
 * manual `npm run backfill:anchors`, which a platform with no shell cannot run.
 *
 * SAFETY.
 *   - Every item is reloaded and re-checked before work starts, and an
 *     in-flight set stops the sweep and an immediate task racing on one id.
 *   - Transactions are already serialised by blockchainService's nonce queue.
 *   - A permanently failing item (e.g. a hash the contract refuses as a
 *     duplicate) stops after MAX_ATTEMPTS instead of spending gas forever.
 *   - Nothing here throws to a caller; failures are logged and retried.
 */

const MAX_ATTEMPTS = 5;
const SWEEP_BATCH = 25;
const SWEEP_INTERVAL_MS = 3 * 60 * 1000;
const FIRST_SWEEP_DELAY_MS = 20 * 1000;

const inFlight = new Set();
let sweeping = false;
let timer = null;

const isBackground = () => blockchainService.isEnabled() && env.BLOCKCHAIN_BACKGROUND;

/** Runs `fn` once for `key` at a time; a second caller for the same key is a no-op. */
const exclusive = async (key, fn) => {
  if (inFlight.has(key)) return null;
  inFlight.add(key);
  try {
    return await fn();
  } finally {
    inFlight.delete(key);
  }
};

// --- Records -------------------------------------------------------------------

const anchorRecordById = (recordId) =>
  exclusive(`record:${recordId}`, async () => {
    const record = await medicalRecordRepository.findById(recordId);
    if (!record || record.blockchain?.status === BLOCKCHAIN_SYNC_STATUS.CONFIRMED) return null;

    const patient = await userRepository.findActiveById(record.patient?._id ?? record.patient);
    if (!patient) return null;

    const attempts = record.blockchain?.attempts || 0;
    const anchor = await blockchainService.anchorRecord({ patient, record });

    // PENDING means the chain is switched off; leave the record untouched.
    if (anchor.status === BLOCKCHAIN_SYNC_STATUS.PENDING) return null;

    record.blockchain = {
      ...anchor,
      attempts: anchor.status === BLOCKCHAIN_SYNC_STATUS.CONFIRMED ? attempts : attempts + 1,
    };
    await record.save({ validateBeforeSave: false });

    if (anchor.status === BLOCKCHAIN_SYNC_STATUS.CONFIRMED) {
      logger.info("Record anchored on-chain", { recordId: String(record._id), txHash: anchor.txHash });

      // Grants made before the anchor landed can follow now.
      const grants = await accessPermissionRepository.findLiveByRecord(record._id);
      for (const grant of grants) {
        if (grant.grantTx?.status !== BLOCKCHAIN_SYNC_STATUS.CONFIRMED) {
          await grantPermissionById(grant._id);
        }
      }
    } else {
      logger.warn("Anchoring failed; will retry", {
        recordId: String(record._id),
        attempt: attempts + 1,
        reason: anchor.lastError,
      });
    }

    return anchor;
  });

// --- Access grants and revocations ---------------------------------------------

async function grantPermissionById(permissionId) {
  return exclusive(`grant:${permissionId}`, async () => {
    const permission = await accessPermissionRepository.findById(permissionId);
    if (!permission || permission.revokedAt || permission.grantTx?.status === BLOCKCHAIN_SYNC_STATUS.CONFIRMED) {
      return null;
    }

    const record = await medicalRecordRepository.findById(permission.record);
    // Not anchored yet: not a failure. The grant follows the anchor.
    if (!record || record.blockchain?.status !== BLOCKCHAIN_SYNC_STATUS.CONFIRMED) return null;

    const doctor = await userRepository.findActiveById(permission.doctor);
    if (!doctor) return null;

    if (permission.expiresAt) record.__grantExpiresAt = permission.expiresAt;

    const attempts = permission.grantTx?.attempts || 0;
    const result = await blockchainService.grantAccessOnChain({ record, doctor });
    if (result.status === BLOCKCHAIN_SYNC_STATUS.PENDING) return null;

    permission.grantTx = {
      ...result,
      attempts: result.status === BLOCKCHAIN_SYNC_STATUS.CONFIRMED ? attempts : attempts + 1,
    };
    await permission.save();
    return result;
  });
}

const revokePermissionById = (permissionId) =>
  exclusive(`revoke:${permissionId}`, async () => {
    const permission = await accessPermissionRepository.findById(permissionId);
    if (!permission?.revokedAt || permission.revokeTx?.status === BLOCKCHAIN_SYNC_STATUS.CONFIRMED) return null;

    // Nothing to revoke on-chain if the grant never reached it.
    if (permission.grantTx?.status !== BLOCKCHAIN_SYNC_STATUS.CONFIRMED) return null;

    const record = await medicalRecordRepository.findById(permission.record);
    const doctor = await userRepository.findById(permission.doctor);
    if (!record || !doctor) return null;

    const attempts = permission.revokeTx?.attempts || 0;
    const result = await blockchainService.revokeAccessOnChain({ record, doctor });
    if (result.status === BLOCKCHAIN_SYNC_STATUS.PENDING) return null;

    permission.revokeTx = {
      ...result,
      attempts: result.status === BLOCKCHAIN_SYNC_STATUS.CONFIRMED ? attempts : attempts + 1,
    };
    await permission.save();
    return result;
  });

// --- Scheduling ----------------------------------------------------------------

/** Fire-and-forget wrapper used by the request handlers. */
const schedule = (label, task) => {
  Promise.resolve()
    .then(task)
    .catch((error) => logger.error(`Background chain task failed: ${label}`, { reason: error.message }));
};

const scheduleAnchor = (recordId) => schedule("anchor", () => anchorRecordById(recordId));
const scheduleGrant = (permissionId) => schedule("grant", () => grantPermissionById(permissionId));
const scheduleRevoke = (permissionId) => schedule("revoke", () => revokePermissionById(permissionId));

/**
 * One pass over everything not yet on-chain. Sequential on purpose: the
 * registrar has one nonce stream, and parallel sends only queue up anyway.
 */
const sweep = async () => {
  if (sweeping || !blockchainService.isEnabled()) return;
  sweeping = true;

  try {
    const status = await blockchainService.getStatus();
    if (!status.connected) {
      logger.warn("Chain sync skipped: chain unreachable", { reason: status.reason });
      return;
    }

    const records = await medicalRecordRepository.findUnanchored(SWEEP_BATCH, MAX_ATTEMPTS);
    for (const record of records) await anchorRecordById(record._id);

    const grants = await accessPermissionRepository.findUnsyncedGrants(SWEEP_BATCH, MAX_ATTEMPTS);
    for (const grant of grants) await grantPermissionById(grant._id);

    const revokes = await accessPermissionRepository.findUnsyncedRevokes(SWEEP_BATCH, MAX_ATTEMPTS);
    for (const revoke of revokes) await revokePermissionById(revoke._id);

    if (records.length || grants.length || revokes.length) {
      logger.info("Chain sync pass complete", {
        records: records.length,
        grants: grants.length,
        revokes: revokes.length,
      });
    }
  } catch (error) {
    logger.error("Chain sync pass failed", { reason: error.message });
  } finally {
    sweeping = false;
  }
};

/** Called once at startup. No-op while blockchain support is switched off. */
const start = () => {
  if (!blockchainService.isEnabled() || timer) return;

  setTimeout(sweep, FIRST_SWEEP_DELAY_MS);
  timer = setInterval(sweep, SWEEP_INTERVAL_MS);
  // Never keep the process alive just for the timer.
  timer.unref?.();

  logger.info("Chain sync worker started", {
    background: env.BLOCKCHAIN_BACKGROUND,
    intervalSeconds: SWEEP_INTERVAL_MS / 1000,
  });
};

const stop = () => {
  if (timer) clearInterval(timer);
  timer = null;
};

module.exports = {
  MAX_ATTEMPTS,
  anchorRecordById,
  grantPermissionById,
  isBackground,
  revokePermissionById,
  scheduleAnchor,
  scheduleGrant,
  scheduleRevoke,
  start,
  stop,
  sweep,
};
