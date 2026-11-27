const crypto = require("crypto");
const { ethers } = require("ethers");

const { getConnection } = require("../config/blockchain");
const { env } = require("../config/env");
const {
  BLOCKCHAIN_SYNC_STATUS,
  CHAIN_TX_TYPES,
  RECORD_TYPE_CODES,
} = require("../constants/records");
const { ROLES } = require("../constants/roles");
const BlockchainTransaction = require("../models/BlockchainTransaction");
const AppError = require("../utils/AppError");

/**
 * Blockchain Service.
 *
 * The only module in the backend that knows ethers.js exists. Everything above
 * it deals in plain objects, so the chain can be swapped, mocked or disabled
 * without touching business logic.
 *
 * DESIGN: anchoring must never lose an upload. The file is already encrypted,
 * pinned and persisted before this service is called, so a chain outage
 * downgrades the record to `blockchain.status: "pending"` rather than failing
 * the request. `scripts/backfillAnchors.js` re-drives anything left pending.
 */

const isEnabled = () => env.BLOCKCHAIN_ENABLED;

/** Below this, the registrar is warned about in logs and in /health. */
const LOW_BALANCE_ETH = 0.02;

/**
 * Derives a deterministic wallet address for a user.
 *
 * WHY CUSTODIAL ADDRESSES EXIST: the contract identifies participants by
 * address, but a patient registering by email has no wallet yet. Rather than
 * blocking every upload behind a MetaMask install, each user gets a stable
 * address derived from a server seed and their immutable MongoDB id.
 *
 * These addresses are an IDENTITY ANCHOR ONLY. They never sign and never need
 * gas — the registrar submits and pays for every transaction. When a patient
 * later links a real wallet, `walletType` flips to "external" and they sign
 * their own access grants.
 *
 * The derivation is one-way: the seed cannot be recovered from an address.
 */
const deriveCustodialAddress = (userId) => {
  const privateKey = crypto
    .createHmac("sha256", Buffer.from(env.CUSTODIAL_WALLET_SEED, "hex"))
    .update(String(userId))
    .digest();

  return new ethers.Wallet(`0x${privateKey.toString("hex")}`).address;
};

/** Converts a hex SHA-256 digest into the bytes32 the contract expects. */
const toBytes32 = (hexDigest) => {
  const normalized = hexDigest.startsWith("0x") ? hexDigest : `0x${hexDigest}`;

  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new AppError("Content hash must be a 32-byte hex digest.", 500);
  }

  return normalized;
};

/**
 * ethers embeds the entire signed transaction in its error messages, which
 * runs to thousands of characters. The BlockchainTransaction.error field is
 * capped, so an untruncated message fails schema validation and the log entry
 * is lost — exactly when the log is most needed.
 */
const MAX_ERROR_LENGTH = 500;

const summarizeError = (error) => String(error?.message ?? error).slice(0, MAX_ERROR_LENGTH);

/**
 * Records a transaction attempt, successful or not.
 * Never throws — a logging failure must not break the caller.
 */
const logTransaction = async (payload) => {
  try {
    return await BlockchainTransaction.create({
      contractAddress: env.CONTRACT_ADDRESS,
      chainId: env.BLOCKCHAIN_CHAIN_ID,
      ...payload,
      ...(payload.error ? { error: String(payload.error).slice(0, MAX_ERROR_LENGTH) } : {}),
    });
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// Transaction serialisation
// ---------------------------------------------------------------------------

/**
 * NONCE MANAGEMENT.
 *
 * Every write goes out from ONE registrar key. Ethereum orders a sender's
 * transactions by a strictly incrementing nonce, and ethers derives that nonce
 * by asking the node for the pending transaction count. Two overlapping
 * requests therefore read the same count and build two transactions with the
 * same nonce — the second is rejected with "nonce has already been used".
 *
 * Awaiting each call is not sufficient protection: the node's pending count
 * can still lag a freshly mined block, and concurrent HTTP requests are the
 * normal case for a web API.
 *
 * The fix has two parts:
 *   1. A promise chain that serialises every submission, so exactly one
 *      transaction is in flight at a time.
 *   2. A locally tracked nonce, seeded once from the chain and incremented
 *      in-process, so correctness never depends on the node's view catching up.
 *
 * On any failure the cached nonce is dropped and re-read from the chain,
 * which recovers from a transaction that was rejected or replaced.
 */
let submissionQueue = Promise.resolve();
let cachedNonce = null;

/** Runs `task` after every previously queued task, regardless of their outcome. */
const enqueue = (task) => {
  const result = submissionQueue.then(task, task);
  submissionQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
};

/**
 * Submits one transaction and waits for confirmation.
 *
 * @param {(overrides: object) => Promise<object>} buildCall receives the
 *        overrides object carrying the explicit nonce.
 */
const submit = (buildCall) =>
  enqueue(async () => {
    const { signer } = getConnection();

    if (cachedNonce === null) {
      cachedNonce = await signer.getNonce("latest");
    }

    try {
      const tx = await buildCall({ nonce: cachedNonce });
      cachedNonce += 1;

      const receipt = await tx.wait(env.BLOCKCHAIN_CONFIRMATIONS);

      return {
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
        receipt,
      };
    } catch (error) {
      // Re-read from the chain next time rather than guessing.
      cachedNonce = null;
      throw error;
    }
  });

/** Test/ops hook — forces the nonce to be re-read from the chain. */
const resetNonce = () => {
  cachedNonce = null;
};

// ---------------------------------------------------------------------------
// Participant registration
// ---------------------------------------------------------------------------

/**
 * Registers a user on-chain if they are not already known to the contract.
 * Idempotent: safe to call on every upload.
 *
 * @returns {Promise<{ address: string, registered: boolean }>}
 */
const ensureParticipantRegistered = async (user) => {
  const { contract } = getConnection();
  const address = user.walletAddress || deriveCustodialAddress(user._id);

  const existing = await contract.getParticipant(address);

  // role 0 == ParticipantRole.None
  if (Number(existing.role) !== 0) {
    return { address, registered: false };
  }

  // keccak of the Mongo id links wallet to account without publishing the id.
  const profileRef = ethers.keccak256(ethers.toUtf8Bytes(String(user._id)));

  const isDoctor = user.role === ROLES.DOCTOR;

  const result = await submit((overrides) =>
    isDoctor
      ? contract.registerDoctor(address, profileRef, overrides)
      : contract.registerPatient(address, profileRef, overrides)
  );

  await logTransaction({
    type: isDoctor ? CHAIN_TX_TYPES.REGISTER_DOCTOR : CHAIN_TX_TYPES.REGISTER_PATIENT,
    status: BLOCKCHAIN_SYNC_STATUS.CONFIRMED,
    txHash: result.txHash,
    blockNumber: result.blockNumber,
    gasUsed: result.gasUsed,
    relatedUser: user._id,
    confirmedAt: new Date(),
  });

  return { address, registered: true };
};

/** Mirrors the Module 2 admin verification onto the chain. */
const verifyDoctorOnChain = async (doctor, adminId) => {
  const { contract } = getConnection();
  const { address } = await ensureParticipantRegistered(doctor);

  if (await contract.isVerifiedDoctor(address)) {
    return { address, alreadyVerified: true };
  }

  const result = await submit((overrides) => contract.verifyDoctor(address, overrides));

  await logTransaction({
    type: CHAIN_TX_TYPES.VERIFY_DOCTOR,
    status: BLOCKCHAIN_SYNC_STATUS.CONFIRMED,
    txHash: result.txHash,
    blockNumber: result.blockNumber,
    gasUsed: result.gasUsed,
    relatedUser: doctor._id,
    initiatedBy: adminId,
    confirmedAt: new Date(),
  });

  return { address, alreadyVerified: false, ...result };
};

// ---------------------------------------------------------------------------
// Record anchoring
// ---------------------------------------------------------------------------

/**
 * Anchors a record's fingerprint on-chain.
 *
 * @returns {Promise<object>} the `blockchain` sub-document to persist. Always
 *          resolves — failures come back as status "failed" with `lastError`,
 *          never as a thrown exception, so an upload is never lost to a chain
 *          problem.
 */
/**
 * Finds a record already anchored for this patient with this content hash.
 *
 * Exists for one failure mode: the anchor transaction was mined, but the
 * server never saw the receipt (an RPC timeout, a restart mid-wait). The
 * database still says "not anchored", and every retry is then refused by the
 * contract as DuplicateContentHash -- the record would show "Failed" forever
 * while actually being on-chain. Reading the patient's ids back recovers it.
 *
 * @returns {Promise<string|null>} the on-chain record id, if found
 */
/**
 * True when a failed call was the contract reverting with the named custom
 * error. ethers often cannot name it ("unknown custom error") when the revert
 * surfaces during gas estimation, so the raw revert data is decoded against
 * the contract's own ABI instead of trusting the message text.
 */
const isRevertNamed = (error, name) => {
  if (error?.revert?.name === name || String(error?.message ?? "").includes(name)) return true;

  const data =
    error?.data ??
    error?.info?.error?.data ??
    /data="(0x[0-9a-fA-F]+)"/.exec(String(error?.message ?? ""))?.[1];

  if (typeof data !== "string" || !data.startsWith("0x")) return false;

  try {
    return getConnection().contract.interface.parseError(data)?.name === name;
  } catch {
    return false;
  }
};

const findExistingAnchor = async ({ patient, record }) => {
  const { contract } = getConnection();
  const address = patient.walletAddress || deriveCustodialAddress(patient._id);
  const wanted = toBytes32(record.integrity.fileHash).toLowerCase();
  const ids = await contract.getPatientRecordIds(address);

  // Newest first: the missed anchor is almost always the latest one.
  for (const id of [...ids].reverse()) {
    const onChain = await contract.getRecord(id);
    if (String(onChain.contentHash).toLowerCase() === wanted) return id.toString();
  }

  return null;
};

const anchorRecord = async ({ patient, record }) => {
  if (!isEnabled()) {
    return { status: BLOCKCHAIN_SYNC_STATUS.PENDING };
  }

  try {
    const { contract } = getConnection();
    const { address } = await ensureParticipantRegistered(patient);

    const contentHash = toBytes32(record.integrity.fileHash);
    const typeCode = RECORD_TYPE_CODES[record.recordType] ?? RECORD_TYPE_CODES.other;

    const result = await submit((overrides) =>
      contract.anchorRecord(address, contentHash, record.storage.cid, typeCode, overrides)
    );

    /**
     * The record id is the return value of a state-changing function, which is
     * not available to the caller — it must be read from the emitted event.
     */
    const anchoredEvent = result.receipt.logs
      .map((log) => {
        try {
          return contract.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((parsed) => parsed?.name === "RecordAnchored");

    const onChainId = anchoredEvent ? anchoredEvent.args.recordId.toString() : null;

    await logTransaction({
      type: CHAIN_TX_TYPES.ANCHOR_RECORD,
      status: BLOCKCHAIN_SYNC_STATUS.CONFIRMED,
      txHash: result.txHash,
      blockNumber: result.blockNumber,
      gasUsed: result.gasUsed,
      onChainId,
      relatedUser: patient._id,
      relatedRecord: record._id,
      confirmedAt: new Date(),
    });

    return {
      status: BLOCKCHAIN_SYNC_STATUS.CONFIRMED,
      onChainId,
      txHash: result.txHash,
      blockNumber: result.blockNumber,
      anchoredAt: new Date(),
    };
  } catch (error) {
    if (isRevertNamed(error, "DuplicateContentHash")) {
      const recoveredId = await findExistingAnchor({ patient, record }).catch(() => null);

      if (recoveredId) {
        return {
          status: BLOCKCHAIN_SYNC_STATUS.CONFIRMED,
          onChainId: recoveredId,
          anchoredAt: new Date(),
          lastError: "Recovered: already anchored on-chain; the original receipt was missed.",
        };
      }
    }

    await logTransaction({
      type: CHAIN_TX_TYPES.ANCHOR_RECORD,
      status: BLOCKCHAIN_SYNC_STATUS.FAILED,
      relatedUser: patient._id,
      relatedRecord: record?._id,
      error: summarizeError(error),
    });

    return {
      status: BLOCKCHAIN_SYNC_STATUS.FAILED,
      lastError: summarizeError(error),
    };
  }
};

// ---------------------------------------------------------------------------
// Access grants
// ---------------------------------------------------------------------------

/**
 * Records an access grant on-chain.
 *
 * Uses `grantAccessFor` (CUSTODIAN_ROLE) because the backend signs on the
 * patient's behalf — custodial addresses hold no gas. A patient with a linked
 * external wallet signs `grantAccess` directly from the browser instead, and
 * the backend only mirrors the result.
 *
 * Never throws: a chain failure leaves the grant pending, and off-chain
 * authorisation still holds, so a doctor is never wrongly let in.
 *
 * @returns {Promise<object>} the grantTx sub-document to persist.
 */
const grantAccessOnChain = async ({ record, doctor }) => {
  if (!isEnabled()) {
    return { status: BLOCKCHAIN_SYNC_STATUS.PENDING };
  }

  try {
    const { contract } = getConnection();
    const onChainId = record.blockchain?.onChainId;

    if (!onChainId) {
      throw new Error("Record is not anchored on-chain yet. Run npm run backfill:anchors.");
    }

    const { address } = await ensureParticipantRegistered(doctor);

    // The contract refuses to grant to an unverified doctor, so mirror the
    // off-chain verification first.
    if (!(await contract.isVerifiedDoctor(address))) {
      await submit((overrides) => contract.verifyDoctor(address, overrides));
    }

    const expiry = record.__grantExpiresAt
      ? Math.floor(new Date(record.__grantExpiresAt).getTime() / 1000)
      : 0;

    const result = await submit((overrides) =>
      contract.grantAccessFor(onChainId, address, expiry, overrides)
    );

    await logTransaction({
      type: CHAIN_TX_TYPES.GRANT_ACCESS,
      status: BLOCKCHAIN_SYNC_STATUS.CONFIRMED,
      txHash: result.txHash,
      blockNumber: result.blockNumber,
      gasUsed: result.gasUsed,
      onChainId: String(onChainId),
      relatedUser: doctor._id,
      relatedRecord: record._id,
      confirmedAt: new Date(),
    });

    return {
      status: BLOCKCHAIN_SYNC_STATUS.CONFIRMED,
      txHash: result.txHash,
      blockNumber: result.blockNumber,
    };
  } catch (error) {
    await logTransaction({
      type: CHAIN_TX_TYPES.GRANT_ACCESS,
      status: BLOCKCHAIN_SYNC_STATUS.FAILED,
      relatedUser: doctor._id,
      relatedRecord: record._id,
      error: summarizeError(error),
    });

    return { status: BLOCKCHAIN_SYNC_STATUS.FAILED, lastError: summarizeError(error) };
  }
};

const revokeAccessOnChain = async ({ record, doctor }) => {
  if (!isEnabled()) {
    return { status: BLOCKCHAIN_SYNC_STATUS.PENDING };
  }

  try {
    const { contract } = getConnection();
    const onChainId = record.blockchain?.onChainId;

    if (!onChainId) {
      throw new Error("Record is not anchored on-chain.");
    }

    const address = doctor.walletAddress || deriveCustodialAddress(doctor._id);
    const result = await submit((overrides) =>
      contract.revokeAccess(onChainId, address, overrides)
    );

    await logTransaction({
      type: CHAIN_TX_TYPES.REVOKE_ACCESS,
      status: BLOCKCHAIN_SYNC_STATUS.CONFIRMED,
      txHash: result.txHash,
      blockNumber: result.blockNumber,
      gasUsed: result.gasUsed,
      onChainId: String(onChainId),
      relatedUser: doctor._id,
      relatedRecord: record._id,
      confirmedAt: new Date(),
    });

    return {
      status: BLOCKCHAIN_SYNC_STATUS.CONFIRMED,
      txHash: result.txHash,
      blockNumber: result.blockNumber,
    };
  } catch (error) {
    await logTransaction({
      type: CHAIN_TX_TYPES.REVOKE_ACCESS,
      status: BLOCKCHAIN_SYNC_STATUS.FAILED,
      relatedUser: doctor._id,
      relatedRecord: record._id,
      error: summarizeError(error),
    });

    return { status: BLOCKCHAIN_SYNC_STATUS.FAILED, lastError: summarizeError(error) };
  }
};

/** Asks the contract directly whether a viewer may read a record. */
const hasAccessOnChain = async (onChainId, viewerAddress) => {
  if (!isEnabled() || !onChainId) {
    return null;
  }

  try {
    const { contract } = getConnection();
    return await contract.hasAccess(onChainId, viewerAddress);
  } catch {
    return null;
  }
};

/** Fire-and-forget audit entry written after a successful decrypt. */
const logAccessOnChain = async ({ record, viewer }) => {
  if (!isEnabled() || !record.blockchain?.onChainId) {
    return null;
  }

  try {
    const { contract } = getConnection();
    const address = viewer.walletAddress || deriveCustodialAddress(viewer._id);

    const result = await submit((overrides) =>
      contract.logAccess(record.blockchain.onChainId, address, overrides)
    );

    await logTransaction({
      type: CHAIN_TX_TYPES.LOG_ACCESS,
      status: BLOCKCHAIN_SYNC_STATUS.CONFIRMED,
      txHash: result.txHash,
      blockNumber: result.blockNumber,
      gasUsed: result.gasUsed,
      onChainId: String(record.blockchain.onChainId),
      relatedUser: viewer._id,
      relatedRecord: record._id,
      confirmedAt: new Date(),
    });

    return result.txHash;
  } catch (error) {
    await logTransaction({
      type: CHAIN_TX_TYPES.LOG_ACCESS,
      status: BLOCKCHAIN_SYNC_STATUS.FAILED,
      relatedUser: viewer._id,
      relatedRecord: record._id,
      error: summarizeError(error),
    });

    return null;
  }
};

/**
 * Reconstructs a record's full history straight from the event log.
 *
 * This reads the chain, not MongoDB, so it is the version a patient can trust
 * even if the database were altered.
 */
/**
 * Public RPC providers cap how many blocks one eth_getLogs call may span
 * (publicnode refuses somewhere between 50k and 100k on Sepolia). Asking for
 * "block 0 to latest" -- twelve million blocks -- failed outright, and the
 * history panel showed no events for records that plainly had them.
 */
const LOG_WINDOW_BLOCKS = 45000;
/** How far back to look when a record's anchor block is unknown (~6 weeks on Sepolia). */
const UNKNOWN_START_WINDOWS = 6;
const RECORD_EVENTS = new Set([
  "RecordAnchored",
  "AccessGranted",
  "AccessRevoked",
  "AccessLogged",
  "RecordDeactivated",
]);

/**
 * Every on-chain event for one record, oldest first.
 *
 * One eth_getLogs per window, filtered by contract address and by the record
 * id -- the first indexed topic of all five record events -- instead of five
 * separate queries over the whole chain. The search starts at the block the
 * record was anchored in, since nothing about it can precede that.
 *
 * @param {string|number} onChainId
 * @param {{ fromBlock?: number }} [options]
 */
const getRecordHistory = async (onChainId, { fromBlock } = {}) => {
  if (!isEnabled() || !onChainId) {
    return [];
  }

  const { contract, provider } = getConnection();
  const address = await contract.getAddress();
  const recordTopic = ethers.zeroPadValue(ethers.toBeHex(BigInt(onChainId)), 32);
  const latest = await provider.getBlockNumber();

  const start =
    Number.isInteger(fromBlock) && fromBlock >= 0
      ? fromBlock
      : Math.max(0, latest - LOG_WINDOW_BLOCKS * UNKNOWN_START_WINDOWS);

  const windows = [];
  for (let from = start; from <= latest; from += LOG_WINDOW_BLOCKS) {
    windows.push([from, Math.min(from + LOG_WINDOW_BLOCKS - 1, latest)]);
  }

  // A few windows at a time: fast for old records, polite to a free RPC.
  const logs = [];
  for (let i = 0; i < windows.length; i += 4) {
    const batch = await Promise.all(
      windows.slice(i, i + 4).map(([from, to]) =>
        provider.getLogs({ address, topics: [null, recordTopic], fromBlock: from, toBlock: to })
      )
    );
    logs.push(...batch.flat());
  }

  return logs
    .map((log) => {
      let parsed;
      try {
        parsed = contract.interface.parseLog(log);
      } catch {
        return null;
      }

      if (!parsed || !RECORD_EVENTS.has(parsed.name)) return null;

      const args = parsed.args;
      return {
        event: parsed.name,
        blockNumber: log.blockNumber,
        txHash: log.transactionHash,
        timestamp: args?.timestamp ? Number(args.timestamp) * 1000 : null,
        doctor: args?.doctor ?? null,
        viewer: args?.viewer ?? null,
        custodial: args?.custodial ?? null,
        expiresAt:
          args?.expiresAt && Number(args.expiresAt) > 0 ? new Date(Number(args.expiresAt) * 1000) : null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.blockNumber - b.blockNumber || (a.timestamp ?? 0) - (b.timestamp ?? 0));
};

/**
 * Asks the chain whether a document matches what was anchored.
 * This is the independent check — it does not consult MongoDB at all.
 */
const verifyOnChain = async (onChainId, fileHash) => {
  if (!isEnabled() || !onChainId) {
    return { available: false, matches: null };
  }

  try {
    const { contract } = getConnection();
    const matches = await contract.verifyRecordIntegrity(onChainId, toBytes32(fileHash));

    return { available: true, matches };
  } catch (error) {
    return { available: false, matches: null, reason: error.message };
  }
};

/** Fetches the on-chain view of a record, for side-by-side comparison in the UI. */
const getOnChainRecord = async (onChainId) => {
  const { contract } = getConnection();
  const record = await contract.getRecord(onChainId);

  return {
    patient: record.patient,
    uploadedBy: record.uploadedBy,
    contentHash: record.contentHash,
    cid: record.cid,
    recordType: Number(record.recordType),
    createdAt: new Date(Number(record.createdAt) * 1000),
    active: record.active,
  };
};

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

/** Used by the health endpoint. Never throws. */
const getStatus = async () => {
  if (!isEnabled()) {
    return { enabled: false, connected: false };
  }

  try {
    const { provider, contract, address, signer } = getConnection();
    const [blockNumber, network, recordCount, balance] = await Promise.all([
      provider.getBlockNumber(),
      provider.getNetwork(),
      contract.recordCount(),
      provider.getBalance(signer.address),
    ]);

    const balanceEth = Number(ethers.formatEther(balance));

    return {
      enabled: true,
      connected: true,
      contractAddress: address,
      chainId: Number(network.chainId),
      blockNumber,
      recordCount: recordCount.toString(),
      // The registrar pays for every anchor. When it runs dry, anchoring
      // stops; surfaced here so it is visible before that happens.
      registrarAddress: signer.address,
      registrarBalance: balanceEth.toFixed(4),
      lowBalance: balanceEth < LOW_BALANCE_ETH,
    };
  } catch (error) {
    return { enabled: true, connected: false, reason: error.message };
  }
};

module.exports = {
  anchorRecord,
  deriveCustodialAddress,
  ensureParticipantRegistered,
  findExistingAnchor,
  getOnChainRecord,
  getRecordHistory,
  getStatus,
  grantAccessOnChain,
  hasAccessOnChain,
  isEnabled,
  logAccessOnChain,
  logTransaction,
  resetNonce,
  revokeAccessOnChain,
  verifyDoctorOnChain,
  verifyOnChain,
};
