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

module.exports = {
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
