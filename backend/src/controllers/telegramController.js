const telegramService = require("../services/telegramService");
const catchAsync = require("../utils/catchAsync");
const { sendSuccess } = require("../utils/sendResponse");

exports.getStatus = catchAsync(async (req, res) => {
  sendSuccess(res, 200, "Telegram status.", await telegramService.getStatus({ actor: req.user }));
});

exports.createLink = catchAsync(async (req, res) => {
  sendSuccess(res, 201, "Open the link and press Start.", await telegramService.createLink({ actor: req.user }));
});

exports.unlink = catchAsync(async (req, res) => {
  sendSuccess(res, 200, "Telegram disconnected.", await telegramService.unlink({ actor: req.user, req }));
});

exports.sendTest = catchAsync(async (req, res) => {
  sendSuccess(res, 200, "Test message sent.", await telegramService.sendTest({ actor: req.user }));
});

/**
 * Telegram's webhook. Unauthenticated by nature, so it is authenticated by the
 * secret Telegram echoes in a header -- set by us in setWebhook, never sent to
 * a browser. Anything else gets a 401 and is not processed.
 *
 * Always answers 200 quickly once authenticated: a non-2xx makes Telegram
 * retry the same update, which would replay a /start link attempt.
 */
exports.webhook = async (req, res) => {
  if (!telegramService.isValidWebhookSecret(req.get("x-telegram-bot-api-secret-token"))) {
    return res.status(401).json({ status: "fail", message: "Unauthorised." });
  }

  res.status(200).json({ ok: true });
  await telegramService.handleUpdate(req.body);
};
