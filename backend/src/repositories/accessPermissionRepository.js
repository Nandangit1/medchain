const { BLOCKCHAIN_SYNC_STATUS } = require("../constants/records");
const AccessPermission = require("../models/AccessPermission");

/** Matches grants that have not been revoked and have not lapsed. */
const liveFilter = () => ({
  revokedAt: null,
  $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
});

const create = (payload) => AccessPermission.create(payload);

const findById = (id) => AccessPermission.findById(id).exec();

const findLive = (recordId, doctorId) =>
  AccessPermission.findOne({ record: recordId, doctor: doctorId, ...liveFilter() }).exec();

/** Includes lapsed grants, so re-granting can reuse the row rather than collide. */
const findActiveRow = (recordId, doctorId) =>
  AccessPermission.findOne({ record: recordId, doctor: doctorId, revokedAt: null }).exec();

const findByRecord = (recordId) =>
  AccessPermission.find({ record: recordId })
    .populate("doctor", "name email doctorProfile.specialization walletAddress")
    .sort({ createdAt: -1 })
    .exec();

const findLiveForDoctor = (doctorId) =>
  AccessPermission.find({ doctor: doctorId, ...liveFilter() })
    .populate("record")
    .populate("patient", "name email gender dateOfBirth patientProfile")
    .sort({ createdAt: -1 })
    .exec();

const findLiveRecordIdsForDoctor = async (doctorId) => {
  const rows = await AccessPermission.find({ doctor: doctorId, ...liveFilter() })
    .select("record")
    .lean()
    .exec();

  return rows.map((row) => row.record);
};

const paginateForPatient = async (patientId, pagination) => {
  const filter = { patient: patientId };

  const [permissions, totalItems] = await Promise.all([
    AccessPermission.find(filter)
      .populate("doctor", "name email doctorProfile.specialization")
      .populate("record", "title recordType")
      .sort({ createdAt: -1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
      .exec(),
    AccessPermission.countDocuments(filter),
  ]);

  return { permissions, totalItems };
};

const revoke = (id, revokedBy) =>
  AccessPermission.findByIdAndUpdate(
    id,
    { revokedAt: new Date(), revokedBy },
    { new: true }
  ).exec();

const updateById = (id, updates) =>
  AccessPermission.findByIdAndUpdate(id, updates, { new: true }).exec();

/** Live grants whose on-chain mirror has not landed yet. */
const findUnsyncedGrants = (limit, maxAttempts) =>
  AccessPermission.find({
    revokedAt: null,
    "grantTx.status": { $ne: BLOCKCHAIN_SYNC_STATUS.CONFIRMED },
    $and: [
      { $or: [{ "grantTx.attempts": { $exists: false } }, { "grantTx.attempts": { $lt: maxAttempts } }] },
      { $or: [{ "grantTx.nextAttemptAt": { $exists: false } }, { "grantTx.nextAttemptAt": { $lte: new Date() } }] },
    ],
  })
    .sort({ createdAt: 1 })
    .limit(limit)
    .exec();

/** Revocations whose on-chain mirror has not landed yet. */
const findUnsyncedRevokes = (limit, maxAttempts) =>
  AccessPermission.find({
    revokedAt: { $ne: null },
    "grantTx.status": BLOCKCHAIN_SYNC_STATUS.CONFIRMED,
    "revokeTx.status": { $ne: BLOCKCHAIN_SYNC_STATUS.CONFIRMED },
    $and: [
      { $or: [{ "revokeTx.attempts": { $exists: false } }, { "revokeTx.attempts": { $lt: maxAttempts } }] },
      { $or: [{ "revokeTx.nextAttemptAt": { $exists: false } }, { "revokeTx.nextAttemptAt": { $lte: new Date() } }] },
    ],
  })
    .sort({ revokedAt: 1 })
    .limit(limit)
    .exec();

/** Live grants on one record, so they can follow as soon as it is anchored. */
const findLiveByRecord = (recordId) =>
  AccessPermission.find({ record: recordId, revokedAt: null }).exec();

/** Gives grants and revocations that exhausted their retries a fresh set. */
const resetExhaustedTransactions = async (maxAttempts) => {
  await AccessPermission.updateMany(
    { "grantTx.status": BLOCKCHAIN_SYNC_STATUS.FAILED, "grantTx.attempts": { $gte: maxAttempts } },
    { $set: { "grantTx.attempts": 0 }, $unset: { "grantTx.nextAttemptAt": 1 } }
  );
  await AccessPermission.updateMany(
    { "revokeTx.status": BLOCKCHAIN_SYNC_STATUS.FAILED, "revokeTx.attempts": { $gte: maxAttempts } },
    { $set: { "revokeTx.attempts": 0 }, $unset: { "revokeTx.nextAttemptAt": 1 } }
  );
};

module.exports = {
  findLiveByRecord,
  resetExhaustedTransactions,
  findUnsyncedGrants,
  findUnsyncedRevokes,
  create,
  findActiveRow,
  findById,
  findByRecord,
  findLive,
  findLiveForDoctor,
  findLiveRecordIdsForDoctor,
  paginateForPatient,
  revoke,
  updateById,
};
