const { BLOCKCHAIN_SYNC_STATUS } = require("../constants/records");
const { DOCTOR_VERIFICATION_STATUS, ROLES } = require("../constants/roles");
const AccessPermission = require("../models/AccessPermission");
const Appointment = require("../models/Appointment");
const BlockchainTransaction = require("../models/BlockchainTransaction");
const MedicalRecord = require("../models/MedicalRecord");
const User = require("../models/User");
const { buildPagination, buildPaginationMeta, buildSort } = require("../utils/pagination");

/**
 * Admin Service — platform-wide analytics and the blockchain explorer.
 *
 * Every figure is produced by an aggregation or a count, never by loading
 * documents and counting them in Node. A dashboard must not get slower as the
 * platform grows.
 */

const listBlockchainTransactions = async (query) => {
  const pagination = buildPagination(query);
  const sort = buildSort(query.sort, ["createdAt", "blockNumber", "type"], { createdAt: -1 });

  const filter = {};

  if (query.type) filter.type = query.type;
  if (query.status) filter.status = query.status;

  if (query.search && query.search.trim().length >= 2) {
    filter.txHash = new RegExp(query.search.trim(), "i");
  }

  const [transactions, totalItems] = await Promise.all([
    BlockchainTransaction.find(filter)
      .populate("relatedUser", "name email role")
      .populate("relatedRecord", "title recordType")
      .sort(sort)
      .skip(pagination.skip)
      .limit(pagination.limit)
      .exec(),
    BlockchainTransaction.countDocuments(filter),
  ]);

  return {
    transactions: transactions.map((tx) => tx.toClientObject()),
    pagination: buildPaginationMeta(totalItems, pagination),
  };
};

const getPlatformStats = async () => {
  const [
    usersByRole,
    doctorsByStatus,
    recordTotals,
    recordsByType,
    uploadsByDay,
    txByStatus,
    activeGrants,
    appointmentsByStatus,
  ] = await Promise.all([
    User.aggregate([{ $group: { _id: "$role", count: { $sum: 1 } } }]),

    User.aggregate([
      { $match: { role: ROLES.DOCTOR } },
      { $group: { _id: "$doctorProfile.verificationStatus", count: { $sum: 1 } } },
    ]),

    MedicalRecord.aggregate([
      { $match: { isDeleted: { $ne: true } } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          anchored: {
            $sum: {
              $cond: [{ $eq: ["$blockchain.status", BLOCKCHAIN_SYNC_STATUS.CONFIRMED] }, 1, 0],
            },
          },
          pending: {
            $sum: {
              $cond: [{ $eq: ["$blockchain.status", BLOCKCHAIN_SYNC_STATUS.PENDING] }, 1, 0],
            },
          },
          failed: {
            $sum: {
              $cond: [{ $eq: ["$blockchain.status", BLOCKCHAIN_SYNC_STATUS.FAILED] }, 1, 0],
            },
          },
          storageBytes: { $sum: "$file.size" },
        },
      },
    ]),

    MedicalRecord.aggregate([
      { $match: { isDeleted: { $ne: true } } },
      { $group: { _id: "$recordType", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),

    // Uploads per day over the last 14 days, for the trend chart.
    MedicalRecord.aggregate([
      {
        $match: {
          isDeleted: { $ne: true },
          createdAt: { $gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),

    BlockchainTransaction.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),

    AccessPermission.countDocuments({
      revokedAt: null,
      $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
    }),

    Appointment.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
  ]);

  const toMap = (rows) =>
    Object.fromEntries(rows.map((row) => [row._id ?? "unknown", row.count]));

  const records = recordTotals[0] || {
    total: 0,
    anchored: 0,
    pending: 0,
    failed: 0,
    storageBytes: 0,
  };

  const roleCounts = toMap(usersByRole);
  const doctorStatus = toMap(doctorsByStatus);

  return {
    users: {
      total: Object.values(roleCounts).reduce((sum, count) => sum + count, 0),
      patients: roleCounts[ROLES.PATIENT] || 0,
      doctors: roleCounts[ROLES.DOCTOR] || 0,
      admins: roleCounts[ROLES.ADMIN] || 0,
    },
    doctors: {
      pending: doctorStatus[DOCTOR_VERIFICATION_STATUS.PENDING] || 0,
      verified: doctorStatus[DOCTOR_VERIFICATION_STATUS.VERIFIED] || 0,
      rejected: doctorStatus[DOCTOR_VERIFICATION_STATUS.REJECTED] || 0,
    },
    records: {
      total: records.total,
      anchored: records.anchored,
      pending: records.pending,
      failed: records.failed,
      storageBytes: records.storageBytes,
      byType: recordsByType.map((row) => ({ recordType: row._id, count: row.count })),
      uploadsByDay: uploadsByDay.map((row) => ({ date: row._id, count: row.count })),
    },
    blockchain: toMap(txByStatus),
    activeGrants,
    appointments: toMap(appointmentsByStatus),
  };
};

module.exports = { getPlatformStats, listBlockchainTransactions };
