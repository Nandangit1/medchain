const notificationService = require("../services/notificationService");
const catchAsync = require("../utils/catchAsync");
const { sendSuccess } = require("../utils/sendResponse");

exports.getNotifications = catchAsync(async (req, res) => {
  const result = await notificationService.list({ actor: req.user, query: req.query });

  sendSuccess(res, 200, "Notifications fetched successfully.", result);
});

exports.getUnreadCount = catchAsync(async (req, res) => {
  const result = await notificationService.unreadCount({ actor: req.user });

  sendSuccess(res, 200, "Unread count fetched successfully.", result);
});

exports.markRead = catchAsync(async (req, res) => {
  const notification = await notificationService.markRead({
    actor: req.user,
    notificationId: req.params.notificationId,
  });

  sendSuccess(res, 200, "Notification marked as read.", { notification });
});

exports.markAllRead = catchAsync(async (req, res) => {
  const result = await notificationService.markAllRead({ actor: req.user });

  sendSuccess(res, 200, "All notifications marked as read.", result);
});
