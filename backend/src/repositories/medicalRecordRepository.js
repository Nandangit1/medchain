const { BLOCKCHAIN_SYNC_STATUS } = require("../constants/records");
const MedicalRecord = require("../models/MedicalRecord");

/**
 * Repository Pattern.
 *
 * Every Mongoose call for medical records lives here. Services above this
 * layer express intent ("find the active record owned by this patient") and
 * stay free of ODM syntax, which keeps the persistence engine swappable and
 * makes the service layer trivially mockable in the Module 11 test suite.
 *
 * Soft-deleted documents are excluded at this boundary so no caller can leak
 * them by forgetting a filter.
 */
const notDeleted = (filter = {}) => ({ ...filter, isDeleted: { $ne: true } });

const create = (payload) => MedicalRecord.create(payload);

const findById = (recordId) => MedicalRecord.findOne(notDeleted({ _id: recordId })).exec();

/**
 * Encryption material is `select: false`, so it must be requested explicitly.
 * Only the download and integrity-verification paths need it.
 */
const findByIdWithSecrets = (recordId) =>
  MedicalRecord.findOne(notDeleted({ _id: recordId })).select("+encryption").exec();

const findManyPaginated = async (filter, pagination, sort = { createdAt: -1 }) => {
  const scopedFilter = notDeleted(filter);

  const [records, totalItems] = await Promise.all([
    MedicalRecord.find(scopedFilter)
      .sort(sort)
      .skip(pagination.skip)
      .limit(pagination.limit)
      .populate("patient", "name email role")
      .populate("uploadedBy", "name email role")
      .exec(),
    MedicalRecord.countDocuments(scopedFilter),
  ]);

  return { records, totalItems };
};

const updateById = (recordId, updates) =>
  MedicalRecord.findOneAndUpdate(notDeleted({ _id: recordId }), updates, {
    new: true,
    runValidators: true,
  }).exec();

const softDeleteById = (recordId, deletedBy) =>
  MedicalRecord.findOneAndUpdate(
    notDeleted({ _id: recordId }),
    { isDeleted: true, deletedAt: new Date(), deletedBy },
    { new: true }
  ).exec();

const countByPatient = (patientId) => MedicalRecord.countDocuments(notDeleted({ patient: patientId }));

const existsByPatientAndHash = (patientId, fileHash) =>
  MedicalRecord.exists(notDeleted({ patient: patientId, "integrity.fileHash": fileHash }));

/**
 * Records not yet confirmed on-chain, oldest first, skipping those that have
 * already failed `maxAttempts` times. Used by the chain sync worker.
 */
const findUnanchored = (limit, maxAttempts) =>
  MedicalRecord.find(
    notDeleted({
      "blockchain.status": { $ne: BLOCKCHAIN_SYNC_STATUS.CONFIRMED },
      $and: [
        { $or: [{ "blockchain.attempts": { $exists: false } }, { "blockchain.attempts": { $lt: maxAttempts } }] },
        { $or: [{ "blockchain.nextAttemptAt": { $exists: false } }, { "blockchain.nextAttemptAt": { $lte: new Date() } }] },
      ],
    })
  )
    .sort({ createdAt: 1 })
    .limit(limit)
    .exec();

/** Gives records that exhausted their retries a fresh set of attempts. */
const resetExhaustedAnchors = (maxAttempts) =>
  MedicalRecord.updateMany(
    notDeleted({
      "blockchain.status": BLOCKCHAIN_SYNC_STATUS.FAILED,
      "blockchain.attempts": { $gte: maxAttempts },
    }),
    { $set: { "blockchain.attempts": 0 }, $unset: { "blockchain.nextAttemptAt": 1 } }
  );

module.exports = {
  findUnanchored,
  resetExhaustedAnchors,
  countByPatient,
  create,
  existsByPatientAndHash,
  findById,
  findByIdWithSecrets,
  findManyPaginated,
  softDeleteById,
  updateById,
};
