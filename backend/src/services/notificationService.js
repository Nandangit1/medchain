const { env } = require("../config/env");
const logger = require("../config/logger");
const Notification = require("../models/Notification");
const userRepository = require("../repositories/userRepository");
const AppError = require("../utils/AppError");
const { buildPagination, buildPaginationMeta } = require("../utils/pagination");
const mailService = require("./mailService");
const telegramService = require("./telegramService");

/**
 * Notification Service.
 *
 * Like the audit service, `push` never throws — failing to notify someone must
 * not undo the action that triggered it.
 *
 * One call fans out to up to three channels. In-app is always written; email is
 * opt-in per call via `email: true`, because not every notification deserves an
 * inbox entry — "a doctor opened your record" is useful in the bell menu and
 * noise in a mailbox.
 *
 * Telegram is opt-in the same way: pass `telegram` as pre-formatted HTML (see
 * telegramService.format*) to post the full content -- the diagnosis, the
 * guidance -- to the user's linked chat, or `true` for title and message only.
 * Users who have not linked a chat are skipped silently.
 */
const push = async ({ user, type, title, message, link, email = false, telegram = false }) => {
  let notification = null;

  try {
    notification = await Notification.create({ user, type, title, message, link });
  } catch (error) {
    logger.error("Failed to create notification", { type, reason: error.message });
  }

  if (email) {
    // Deliberately not awaited into the caller's critical path beyond this
    // point: the in-app record is already durable, and mail is best-effort.
    try {
      const recipient = await userRepository.findById(user);

      if (recipient?.email) {
        await mailService.send({
          to: recipient.email,
          subject: title,
          title,
          body: `<p>Hello ${recipient.name},</p><p>${message}</p>`,
          action: link ? { label: "Open MedChain", url: `${env.APP_URL}${link}` } : undefined,
        });
      }
    } catch (error) {
      logger.error("Failed to email notification", { type, reason: error.message });
    }
  }

  if (telegram) {
    const html =
      typeof telegram === "string"
        ? telegram
        : `<b>${telegramService.escapeHtml(title)}</b>

${telegramService.escapeHtml(message)}`;

    // sendToUser never throws; delivery failures are logged inside it.
    await telegramService.sendToUser(user, html, link);
  }

  return notification;
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
