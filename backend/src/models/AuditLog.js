const mongoose = require("mongoose");

const { AUDIT_ACTIONS, AUDIT_CATEGORIES, AUDIT_OUTCOMES } = require("../constants/audit");

/**
 * Append-only record of who did what.
 *
 * Deliberately has NO update or delete path anywhere in the codebase — the
 * repository exposes create and read only. An audit trail that the
 * application can rewrite proves nothing.
 *
 * Entries carry the actor's role and IP as they were AT THE TIME. Resolving
 * them from the user document at read time would rewrite history whenever
 * someone's role changed.
 */
const auditLogSchema = new mongoose.Schema(
  {
    action: {
      type: String,
      enum: Object.values(AUDIT_ACTIONS),
      required: true,
      index: true,
    },
    category: {
      type: String,
      enum: Object.values(AUDIT_CATEGORIES),
      required: true,
      index: true,
    },
    outcome: {
      type: String,
      enum: Object.values(AUDIT_OUTCOMES),
      default: AUDIT_OUTCOMES.SUCCESS,
    },

    actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    actorEmail: { type: String, trim: true },
    actorRole: { type: String, trim: true },

    /** Whoever the action was performed upon, when that differs from the actor. */
    targetUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    targetRecord: { type: mongoose.Schema.Types.ObjectId, ref: "MedicalRecord", index: true },

    description: { type: String, trim: true, maxlength: 500 },
    /** Free-form context. Scrubbed of secrets before it reaches here. */
    metadata: { type: mongoose.Schema.Types.Mixed },

    ipAddress: { type: String, trim: true },
    userAgent: { type: String, trim: true, maxlength: 300 },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ actor: 1, createdAt: -1 });

auditLogSchema.methods.toClientObject = function toClientObject() {
  const entry = this.toObject();
  delete entry.__v;
  return entry;
};

const AuditLog = mongoose.model("AuditLog", auditLogSchema);

module.exports = AuditLog;
