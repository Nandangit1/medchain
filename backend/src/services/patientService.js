const { BLOCKCHAIN_SYNC_STATUS } = require("../constants/records");
const AccessPermission = require("../models/AccessPermission");
const MedicalRecord = require("../models/MedicalRecord");
const accessPermissionRepository = require("../repositories/accessPermissionRepository");
const blockchainService = require("./blockchainService");

/**
 * Patient Service — dashboard aggregates and wallet identity.
 *
 * Counts are computed with aggregation rather than by loading documents,
 * because a dashboard should not pull a patient's entire record set into
 * memory just to display a number.
 */

const getDashboard = async ({ actor }) => {
  const patientId = actor._id;

  const [totals, byType, activeGrants, recentRecords] = await Promise.all([
    MedicalRecord.aggregate([
      { $match: { patient: patientId, isDeleted: { $ne: true } } },
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
      { $match: { patient: patientId, isDeleted: { $ne: true } } },
      { $group: { _id: "$recordType", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    AccessPermission.countDocuments({
      patient: patientId,
      revokedAt: null,
      $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
    }),
    MedicalRecord.find({ patient: patientId, isDeleted: { $ne: true } })
      .sort({ createdAt: -1 })
      .limit(5)
      .exec(),
  ]);

  const summary = totals[0] || {
    total: 0,
    anchored: 0,
    pending: 0,
    failed: 0,
    storageBytes: 0,
  };

  return {
    records: {
      total: summary.total,
      anchored: summary.anchored,
      pending: summary.pending,
      failed: summary.failed,
      storageBytes: summary.storageBytes,
    },
    recordsByType: byType.map((entry) => ({ recordType: entry._id, count: entry.count })),
    activeGrants,
    recentRecords: recentRecords.map((record) => record.toClientObject()),
  };
};

/**
 * The patient's on-chain identity.
 *
 * A custodial address is derived deterministically and never signs anything —
 * it exists so records can be anchored before the patient has a wallet.
 */
const getWallet = async ({ actor }) => {
  const address =
    actor.walletAddress ||
    (blockchainService.isEnabled() ? blockchainService.deriveCustodialAddress(actor._id) : null);

  const permissions = await accessPermissionRepository.paginateForPatient(actor._id, {
    skip: 0,
    limit: 100,
  });

  return {
    address,
    walletType: actor.walletType,
    linked: Boolean(actor.walletAddress),
    blockchainEnabled: blockchainService.isEnabled(),
    activeGrants: permissions.permissions
      .filter((permission) => permission.isLive())
      .map((permission) => permission.toClientObject()),
  };
};

module.exports = { getDashboard, getWallet };
