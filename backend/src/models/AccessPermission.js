const mongoose = require("mongoose");

const { BLOCKCHAIN_SYNC_STATUS } = require("../constants/records");

/**
 * A patient's grant of access to one record, for one doctor.
 *
 * The blockchain is the authority on whether access is currently valid — this
 * collection is the queryable mirror that makes "show me everyone who can see
 * my records" a single indexed find instead of an event-log scan.
 *
 * Revocation is recorded, never deleted: an audit trail that can be erased is
 * not an audit trail.
 */
const accessPermissionSchema = new mongoose.Schema(
  {
    record: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MedicalRecord",
      required: true,
      index: true,
    },
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    doctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    grantedAt: { type: Date, default: Date.now },
    /** null means the grant never expires. */
    expiresAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    revokedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    /** True when the platform signed on the patient's behalf. */
    custodial: { type: Boolean, default: true },
    note: { type: String, trim: true, maxlength: 300 },

    grantTx: {
      status: {
        type: String,
        enum: Object.values(BLOCKCHAIN_SYNC_STATUS),
        default: BLOCKCHAIN_SYNC_STATUS.PENDING,
      },
      txHash: String,
      blockNumber: Number,
      lastError: { type: String, maxlength: 500 },
    },
    revokeTx: {
      status: { type: String, enum: Object.values(BLOCKCHAIN_SYNC_STATUS) },
      txHash: String,
      blockNumber: Number,
      lastError: { type: String, maxlength: 500 },
    },
  },
  { timestamps: true }
);

/**
 * At most one LIVE grant per (record, doctor). Revoked rows are excluded from
 * the constraint so the same doctor can be re-granted access later and both
 * events survive in the history.
 */
accessPermissionSchema.index(
  { record: 1, doctor: 1 },
  { unique: true, partialFilterExpression: { revokedAt: null } }
);
accessPermissionSchema.index({ doctor: 1, revokedAt: 1 });

accessPermissionSchema.methods.isLive = function isLive() {
  if (this.revokedAt) return false;
  if (this.expiresAt && this.expiresAt.getTime() <= Date.now()) return false;
  return true;
};

accessPermissionSchema.methods.toClientObject = function toClientObject() {
  const permission = this.toObject();
  permission.live = this.isLive();
  delete permission.__v;
  return permission;
};

const AccessPermission = mongoose.model("AccessPermission", accessPermissionSchema);

module.exports = AccessPermission;
