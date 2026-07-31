const mongoose = require("mongoose");

const { NOTIFICATION_TYPES } = require("../constants/notifications");

/**
 * In-app notification.
 *
 * `link` is a frontend route rather than a URL, so the notification stays
 * valid if the deployment moves origin.
 */
const notificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: Object.values(NOTIFICATION_TYPES),
      required: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 140 },
    message: { type: String, trim: true, maxlength: 500 },
    link: { type: String, trim: true, maxlength: 300 },
    readAt: { type: Date, default: null },
  },
  { timestamps: true }
);

notificationSchema.index({ user: 1, readAt: 1, createdAt: -1 });

/**
 * Notifications are transient by nature — they are convenience, not the audit
 * trail. A TTL index expires them after 90 days so the collection cannot grow
 * without bound. The AuditLog keeps the permanent record.
 */
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

notificationSchema.methods.toClientObject = function toClientObject() {
  const notification = this.toObject();
  notification.read = Boolean(notification.readAt);
  delete notification.__v;
  return notification;
};

const Notification = mongoose.model("Notification", notificationSchema);

module.exports = Notification;
module.exports.NOTIFICATION_TYPES = NOTIFICATION_TYPES;
