const logger = require("../config/logger");
const Notification = require("../models/Notification");
const AppError = require("../utils/AppError");
const { buildPagination, buildPaginationMeta } = require("../utils/pagination");

/**
 * Notification Service.
 *
 * Like the audit service, `push` never throws — failing to notify someone must
 * not undo the action that triggered it.
 */
const push = async ({ user, type, title, message, link }) => {
  try {
    return await Notification.create({ user, type, title, message, link });
  } catch (error) {
    logger.error("Failed to create notification", { type, reason: error.message });
    return null;
  }
};

const list = async ({ actor, query }) => {
  const pagination = buildPagination(query);
  const filter = { user: actor._id };

  if (query.unread === "true") {
    filter.readAt = null;
  }

  const [notifications, totalItems, unreadCount] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip(pagination.skip).limit(pagination.limit).exec(),
    Notification.countDocuments(filter),
    Notification.countDocuments({ user: actor._id, readAt: null }),
  ]);

  return {
    notifications: notifications.map((notification) => notification.toClientObject()),
    unreadCount,
    pagination: buildPaginationMeta(totalItems, pagination),
  };
};

const unreadCount = async ({ actor }) => ({
  unreadCount: await Notification.countDocuments({ user: actor._id, readAt: null }),
});

const markRead = async ({ actor, notificationId }) => {
  // Scoped by user, so one account can never mark another's notification read.
  const notification = await Notification.findOneAndUpdate(
    { _id: notificationId, user: actor._id, readAt: null },
    { readAt: new Date() },
    { new: true }
  ).exec();

  if (!notification) {
    throw new AppError("Notification not found.", 404);
  }

  return notification.toClientObject();
};

const markAllRead = async ({ actor }) => {
  const result = await Notification.updateMany(
    { user: actor._id, readAt: null },
    { readAt: new Date() }
  );

  return { updated: result.modifiedCount };
};

module.exports = { list, markAllRead, markRead, push, unreadCount };
