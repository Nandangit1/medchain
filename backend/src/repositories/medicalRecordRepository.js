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

module.exports = {
  countByPatient,
  create,
  existsByPatientAndHash,
  findById,
  findByIdWithSecrets,
  findManyPaginated,
  softDeleteById,
  updateById,
};
