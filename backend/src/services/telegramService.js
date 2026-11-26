const crypto = require("crypto");

const { env } = require("../config/env");
const logger = require("../config/logger");
const { AUDIT_ACTIONS } = require("../constants/audit");
const { ROLES } = require("../constants/roles");
const diagnosisRepository = require("../repositories/diagnosisRepository");
const medicalRecordRepository = require("../repositories/medicalRecordRepository");
const userRepository = require("../repositories/userRepository");
const AppError = require("../utils/AppError");
const auditService = require("./auditService");

/**
 * Telegram Service.
 *
 * Delivers what a doctor gives a patient (diagnoses, consultation notes,
 * uploaded reports, visit guidance) as Telegram messages, so it can be read
 * without signing in.
 *
 * LINKING. The site never asks for a phone number or a chat id. The user
 * presses "Connect Telegram", gets a t.me deep link carrying a one-time code,
 * and presses Start in the bot. The bot receives `/start <code>`, and that
 * code -- valid for 15 minutes, stored only as a hash -- is what ties the chat
 * to the account. Nobody can link a chat to someone else's account without a
 * code minted inside that person's signed-in session.
 *
 * WHAT IS SENT. Text summaries and a link back to the site; never the
 * decrypted file. The records are encrypted at rest precisely so that plaintext
 * does not sit on third-party servers, and bot chats are not end-to-end
 * encrypted. The full document stays one tap away behind the normal sign-in.
 *
 * Like mail, delivery is best-effort: `sendToUser` never throws, so a Telegram
 * outage cannot roll back the diagnosis that triggered the message.
 */

const LINK_CODE_TTL_MINUTES = 15;
const API_BASE = "https://api.telegram.org";
const WEBHOOK_PATH = "/api/v1/telegram/webhook";

let botUsername = null;
let pollingActive = false;

const isEnabled = () => Boolean(env.TELEGRAM_BOT_TOKEN);

/** Telegram allows only A-Z a-z 0-9 _ - in the secret header; hex qualifies. */
const webhookSecret = () =>
  crypto.createHash("sha256").update(`telegram-webhook:${env.JWT_SECRET}`).digest("hex").slice(0, 48);

const hashCode = (code) => crypto.createHash("sha256").update(String(code)).digest("hex");

/** Escapes text for parse_mode=HTML, the only markup Telegram parses safely. */
const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const callApi = async (method, payload = {}, timeoutMs = 15000) => {
  const response = await fetch(`${API_BASE}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const body = await response.json().catch(() => ({}));

  if (!body.ok) {
    const error = new Error(body.description || `Telegram ${method} failed (${response.status})`);
    error.code = body.error_code;
    throw error;
  }

  return body.result;
};

const getBotUsername = async () => {
  if (botUsername || !isEnabled()) return botUsername;

  try {
    const me = await callApi("getMe");
    botUsername = me.username;
  } catch (error) {
    logger.error("Telegram getMe failed; check TELEGRAM_BOT_TOKEN", { reason: error.message });
  }

  return botUsername;
};

/** Only https links can become buttons; a localhost link would be rejected. */
const appLink = (path) => (path && /^https:\/\//.test(env.APP_URL) ? `${env.APP_URL}${path}` : null);

const sendMessage = async (chatId, html, link) => {
  const url = appLink(link);

  return callApi("sendMessage", {
    chat_id: chatId,
    text: html.slice(0, 4000),
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    reply_markup: url ? { inline_keyboard: [[{ text: "Open in MedChain", url }]] } : undefined,
  });
};

/**
 * Best-effort delivery to a user's linked chat.
 *
 * @param {string|object} userId
 * @param {string} html  already-escaped HTML (use the format* helpers)
 * @param {string} [link] site path for the "Open in MedChain" button
 * @returns {Promise<boolean>} whether a message was delivered
 */
const sendToUser = async (userId, html, link) => {
  if (!isEnabled()) return false;

  try {
    const user = await userRepository.findByIdWithTelegram(userId);
    const chatId = user?.telegram?.chatId;

    if (!chatId || !user.isActive) return false;

    await sendMessage(chatId, html, link);
    return true;
  } catch (error) {
    // 403 means the user blocked the bot or deleted the chat. Unlink, so we
    // stop trying and the profile page shows the truth.
    if (error.code === 403) {
      await userRepository
        .updateById(userId, {
          $unset: { "telegram.chatId": 1, "telegram.username": 1, "telegram.linkedAt": 1 },
        })
        .catch(() => null);
      logger.info("Telegram chat blocked the bot; unlinked", { userId: String(userId) });
    } else {
      logger.error("Telegram delivery failed", { userId: String(userId), reason: error.message });
    }
    return false;
  }
};

// --- Message formatting ------------------------------------------------------

const SEVERITY_LABELS = {
  low: "🟢 Low",
  moderate: "🟡 Moderate",
  high: "🟠 High",
  critical: "🔴 Critical",
};

const formatDate = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
    : null;

const formatDiagnosis = ({ diagnosis, doctorName, heading = "🩺 New diagnosis from your doctor" }) => {
  const lines = [
    `<b>${escapeHtml(heading)}</b>`,
    "",
    `<b>Doctor:</b> ${escapeHtml(doctorName)}`,
    `<b>Summary:</b> ${escapeHtml(diagnosis.summary)}`,
  ];

  if (diagnosis.severity) lines.push(`<b>Severity:</b> ${SEVERITY_LABELS[diagnosis.severity] || escapeHtml(diagnosis.severity)}`);
  if (diagnosis.icdCode) lines.push(`<b>ICD-10:</b> <code>${escapeHtml(diagnosis.icdCode)}</code>`);
  if (diagnosis.followUpAt) lines.push(`<b>Follow-up:</b> ${formatDate(diagnosis.followUpAt)}`);
  if (diagnosis.details) lines.push("", "<b>Doctor's guidance:</b>", escapeHtml(diagnosis.details));

  return lines.join("\n");
};

const RECORD_TYPE_ICONS = {
  lab_report: "🧪",
  prescription: "💊",
  diagnosis: "🩺",
  imaging: "🩻",
  discharge_summary: "🏥",
  vaccination: "💉",
  insurance: "🛡️",
};

const formatSize = (bytes) => {
  if (!bytes) return null;
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1048576).toFixed(1)} MB`;
};

const ANCHOR_LABELS = {
  confirmed: "✅ anchored on the blockchain",
  pending: "⏳ waiting to be anchored on the blockchain",
  failed: "⚠️ anchoring failed (will retry)",
};

/**
 * Everything MedChain knows about a report, as one message: what it is, when
 * it was taken, the findings written in its description, and the proof that it
 * has not been altered. The file itself is never attached -- see the header.
 */
const formatRecord = ({ record, heading, uploaderName }) => {
  const type = String(record.recordType || "other");
  const icon = RECORD_TYPE_ICONS[type] || "📄";
  const tags = (record.tags || []).filter(Boolean);
  const hash = record.integrity?.fileHash;
  const size = formatSize(record.file?.size);

  return [
    `<b>${icon} ${escapeHtml(heading || "Medical report")}</b>`,
    "",
    `<b>Title:</b> ${escapeHtml(record.title)}`,
    `<b>Type:</b> ${escapeHtml(type.replace(/_/g, " "))}`,
    record.recordDate ? `<b>Report date:</b> ${formatDate(record.recordDate)}` : null,
    uploaderName ? `<b>Added by:</b> ${escapeHtml(uploaderName)}` : null,
    record.description ? `\n<b>Details:</b>\n${escapeHtml(record.description)}` : null,
    tags.length
      ? `\n<b>Tags:</b> ${tags.map((tag) => `#${escapeHtml(tag.replace(/\s+/g, "_"))}`).join(" ")}`
      : null,
    "",
    record.file?.originalName
      ? `<b>File:</b> ${escapeHtml(record.file.originalName)}${size ? ` (${size})` : ""}`
      : null,
    hash ? `<b>Fingerprint:</b> <code>${escapeHtml(hash.slice(0, 16))}…</code>` : null,
    record.blockchain?.status
      ? `<b>Integrity:</b> ${ANCHOR_LABELS[record.blockchain.status] || escapeHtml(record.blockchain.status)}`
      : null,
    "",
    "<i>The file stays encrypted in MedChain. Tap the button to view or download it.</i>",
  ]
    .filter((line) => line !== null)
    .join("\n");
};

const formatDocument = ({ record, doctorName }) =>
  formatRecord({ record, heading: "Your doctor added a document", uploaderName: doctorName });

const formatVisitNotes = ({ appointment, doctorName, notes }) =>
  [
    "<b>✅ Consultation completed</b>",
    "",
    `<b>Doctor:</b> ${escapeHtml(doctorName)}`,
    appointment?.scheduledFor ? `<b>Date:</b> ${formatDate(appointment.scheduledFor)}` : null,
    appointment?.reason ? `<b>Reason:</b> ${escapeHtml(appointment.reason)}` : null,
    "",
    "<b>Doctor's guidance:</b>",
    escapeHtml(notes),
  ]
    .filter((line) => line !== null)
    .join("\n");

// --- Linking ---------------------------------------------------------------

const getStatus = async ({ actor }) => {
  const user = await userRepository.findByIdWithTelegram(actor._id);

  return {
    configured: isEnabled(),
    botUsername: await getBotUsername(),
    linked: Boolean(user?.telegram?.chatId),
    username: user?.telegram?.username || null,
    linkedAt: user?.telegram?.linkedAt || null,
  };
};

const createLink = async ({ actor }) => {
  if (!isEnabled()) {
    throw new AppError("Telegram is not configured on this server yet.", 503);
  }

  const username = await getBotUsername();

  if (!username) {
    throw new AppError("The Telegram bot could not be reached. Try again shortly.", 502);
  }

  // 16 random bytes, URL-safe; Telegram allows up to 64 chars in a start parameter.
  const code = crypto.randomBytes(16).toString("base64url");
  const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MINUTES * 60 * 1000);

  await userRepository.updateById(actor._id, {
    "telegram.linkCodeHash": hashCode(code),
    "telegram.linkCodeExpiresAt": expiresAt,
  });

  return {
    deepLink: `https://t.me/${username}?start=${code}`,
    botUsername: username,
    expiresAt,
  };
};

const unlink = async ({ actor, req }) => {
  const user = await userRepository.findByIdWithTelegram(actor._id);
  const chatId = user?.telegram?.chatId;

  await userRepository.updateById(actor._id, {
    $unset: {
      "telegram.chatId": 1,
      "telegram.username": 1,
      "telegram.linkedAt": 1,
      "telegram.linkCodeHash": 1,
      "telegram.linkCodeExpiresAt": 1,
    },
  });

  if (chatId && isEnabled()) {
    sendMessage(chatId, "MedChain is disconnected from this chat. You will get no more messages here.").catch(
      () => null
    );
  }

  await auditService.record({
    action: AUDIT_ACTIONS.USER_TELEGRAM_UNLINKED,
    actor,
    description: "Disconnected Telegram",
    req,
  });

  return { linked: false };
};

const sendTest = async ({ actor }) => {
  const delivered = await sendToUser(
    actor._id,
    `<b>👋 Hello ${escapeHtml(actor.name)}</b>\n\nThis chat is connected to MedChain. Diagnoses, reports and guidance from your doctors will arrive here.`,
    "/profile"
  );

  if (!delivered) {
    throw new AppError("Telegram is not connected for this account, or the message could not be sent.", 400);
  }

  return { delivered };
};

// --- Bot commands ----------------------------------------------------------

const HELP_TEXT = [
  "<b>MedChain bot</b>",
  "",
  "/reports – your five most recent medical reports",
  "/latest – your five most recent diagnoses and doctor guidance",
  "/stop – disconnect this chat from MedChain",
  "/help – show this message",
  "",
  "To connect, open MedChain → Profile → Connect Telegram.",
].join("\n");

const linkChat = async (message, code) => {
  const chatId = String(message.chat.id);
  const user = await userRepository.findByTelegramLinkCode(hashCode(code));

  if (
    !user ||
    !user.isActive ||
    !user.telegram?.linkCodeExpiresAt ||
    user.telegram.linkCodeExpiresAt.getTime() < Date.now()
  ) {
    await sendMessage(
      chatId,
      "That link has expired or was already used. Open MedChain → Profile → <b>Connect Telegram</b> to get a fresh one."
    );
    return;
  }

  // One account per chat: a chat previously tied to someone else is released.
  const previous = await userRepository.findByTelegramChatId(chatId);
  if (previous && String(previous._id) !== String(user._id)) {
    await userRepository.updateById(previous._id, {
      $unset: { "telegram.chatId": 1, "telegram.username": 1, "telegram.linkedAt": 1 },
    });
  }

  await userRepository.updateById(user._id, {
    "telegram.chatId": chatId,
    "telegram.username": message.from?.username || message.from?.first_name || null,
    "telegram.linkedAt": new Date(),
    $unset: { "telegram.linkCodeHash": 1, "telegram.linkCodeExpiresAt": 1 },
  });

  await auditService.record({
    action: AUDIT_ACTIONS.USER_TELEGRAM_LINKED,
    actor: user,
    description: "Connected a Telegram chat",
  });

  const intro =
    user.role === ROLES.PATIENT
      ? "Diagnoses, reports and guidance from your doctors will arrive here as soon as they are added.\n\nSend /latest to see your recent ones."
      : "Account notifications will arrive here.";

  await sendMessage(chatId, `<b>✅ Connected, ${escapeHtml(user.name)}</b>\n\n${intro}`, "/profile");
};

const sendLatest = async (chatId) => {
  const user = await userRepository.findByTelegramChatId(chatId);

  if (!user) {
    await sendMessage(chatId, "This chat is not connected yet.\n\n" + HELP_TEXT);
    return;
  }

  if (user.role !== ROLES.PATIENT) {
    await sendMessage(chatId, "/latest lists a patient's diagnoses, so it is only available on patient accounts.");
    return;
  }

  const { diagnoses } = await diagnosisRepository.paginate({ patient: user._id }, { skip: 0, limit: 5 });

  if (diagnoses.length === 0) {
    await sendMessage(chatId, "No diagnoses or doctor notes yet. They will appear here as soon as a doctor adds one.");
    return;
  }

  const blocks = diagnoses.map((diagnosis, index) =>
    [
      `<b>${index + 1}. ${escapeHtml(diagnosis.summary)}</b>`,
      `${escapeHtml(diagnosis.doctor?.name || "Doctor")} · ${formatDate(diagnosis.createdAt)}${
        diagnosis.severity ? ` · ${SEVERITY_LABELS[diagnosis.severity] || diagnosis.severity}` : ""
      }`,
      diagnosis.details ? escapeHtml(diagnosis.details.slice(0, 500)) + (diagnosis.details.length > 500 ? "…" : "") : null,
    ]
      .filter(Boolean)
      .join("\n")
  );

  await sendMessage(chatId, `<b>🩺 Your latest doctor notes</b>\n\n${blocks.join("\n\n")}`, "/patient/records");
};

const sendLatestReports = async (chatId) => {
  const user = await userRepository.findByTelegramChatId(chatId);

  if (!user) {
    await sendMessage(chatId, "This chat is not connected yet.\n\n" + HELP_TEXT);
    return;
  }

  if (user.role !== ROLES.PATIENT) {
    await sendMessage(chatId, "/reports lists medical records, so it only works on patient accounts.");
    return;
  }

  const { records, totalItems } = await medicalRecordRepository.findManyPaginated(
    { patient: user._id },
    { skip: 0, limit: 5 },
    { recordDate: -1, createdAt: -1 }
  );

  if (records.length === 0) {
    await sendMessage(
      chatId,
      "You have no medical reports in MedChain yet. Upload one on the website and it will appear here."
    );
    return;
  }

  const lines = records.map((record, index) => {
    const icon = RECORD_TYPE_ICONS[record.recordType] || "📄";
    const summary = record.description
      ? `\n   ${escapeHtml(record.description.slice(0, 160))}${record.description.length > 160 ? "…" : ""}`
      : "";
    return `${index + 1}. ${icon} <b>${escapeHtml(record.title)}</b> · ${formatDate(
      record.recordDate || record.createdAt
    )}${summary}`;
  });

  await sendMessage(
    chatId,
    `<b>📁 Your latest reports</b> (${records.length} of ${totalItems})\n\n${lines.join("\n\n")}`,
    "/patient/records"
  );
};

const stopChat = async (chatId) => {
  const user = await userRepository.findByTelegramChatId(chatId);

  if (user) {
    await userRepository.updateById(user._id, {
      $unset: { "telegram.chatId": 1, "telegram.username": 1, "telegram.linkedAt": 1 },
    });
    await auditService.record({
      action: AUDIT_ACTIONS.USER_TELEGRAM_UNLINKED,
      actor: user,
      description: "Disconnected Telegram from the bot (/stop)",
    });
  }

  await sendMessage(chatId, "Disconnected. You will get no more MedChain messages here.");
};

/** Handles one Telegram Update, from the webhook or from polling. */
const handleUpdate = async (update) => {
  const message = update?.message;
  const text = message?.text?.trim();

  if (!text || message.chat?.type !== "private") return;

  const chatId = String(message.chat.id);
  const [command, argument] = text.split(/\s+/, 2);

  try {
    switch (command.split("@")[0]) {
      case "/start":
        if (argument) await linkChat(message, argument);
        else await sendMessage(chatId, HELP_TEXT);
        break;
      case "/latest":
        await sendLatest(chatId);
        break;
      case "/reports":
        await sendLatestReports(chatId);
        break;
      case "/stop":
        await stopChat(chatId);
        break;
      default:
        await sendMessage(chatId, HELP_TEXT);
    }
  } catch (error) {
    logger.error("Telegram update handling failed", { reason: error.message });
  }
};

/**
 * Sends one record's details to its patient on demand ("Send to Telegram").
 * Only the owning patient may do this; the caller has already loaded the
 * record through the normal permission check.
 */
const sendRecordToOwner = async ({ actor, record }) => {
  const ownerId = String(record.patient?._id ?? record.patient);

  if (actor.role !== ROLES.PATIENT || ownerId !== String(actor._id)) {
    throw new AppError("Only the patient who owns this record can send it to Telegram.", 403);
  }

  if (!isEnabled()) {
    throw new AppError("Telegram is not configured on this server yet.", 503);
  }

  const delivered = await sendToUser(
    actor._id,
    formatRecord({ record, heading: "Medical report", uploaderName: record.uploadedBy?.name }),
    `/patient/records/${record._id}`
  );

  if (!delivered) {
    throw new AppError("Connect Telegram on your Profile page first, then try again.", 400);
  }

  return { delivered };
};

/** Constant-time check of the header Telegram echoes back on every webhook call. */
const isValidWebhookSecret = (supplied) => {
  const expected = Buffer.from(webhookSecret());
  const given = Buffer.from(String(supplied || ""));
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
};

// --- Receiving updates -------------------------------------------------------

const pollLoop = async () => {
  let offset = 0;

  while (pollingActive) {
    try {
      const updates = await callApi("getUpdates", { offset, timeout: 25, allowed_updates: ["message"] }, 35000);

      for (const update of updates) {
        offset = update.update_id + 1;
        await handleUpdate(update);
      }
    } catch (error) {
      // 409: another process is polling or a webhook is set. Back off rather than spin.
      logger.warn("Telegram polling error", { reason: error.message });
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
};

/**
 * Called once at startup. Webhook when the site has a public https URL --
 * Telegram then wakes a sleeping Render instance itself. Long polling
 * otherwise, which works from a laptop with no inbound connectivity.
 */
const start = async () => {
  if (!isEnabled()) {
    logger.info("Telegram disabled (no TELEGRAM_BOT_TOKEN).");
    return;
  }

  const mode = env.TELEGRAM_MODE || (/^https:\/\//.test(env.APP_URL) ? "webhook" : "polling");

  try {
    await getBotUsername();

    await callApi("setMyCommands", {
      commands: [
        { command: "reports", description: "Your latest medical reports" },
        { command: "latest", description: "Recent diagnoses and doctor guidance" },
        { command: "stop", description: "Disconnect this chat" },
        { command: "help", description: "How this bot works" },
      ],
    });

    if (mode === "webhook") {
      await callApi("setWebhook", {
        url: `${env.APP_URL}${WEBHOOK_PATH}`,
        secret_token: webhookSecret(),
        allowed_updates: ["message"],
        drop_pending_updates: false,
      });
      logger.info("Telegram webhook registered", { bot: botUsername, url: `${env.APP_URL}${WEBHOOK_PATH}` });
    } else {
      await callApi("deleteWebhook", { drop_pending_updates: false });
      pollingActive = true;
      pollLoop();
      logger.info("Telegram long polling started", { bot: botUsername });
    }
  } catch (error) {
    logger.error("Telegram start-up failed; messages will not be delivered", { reason: error.message });
  }
};

const stop = () => {
  pollingActive = false;
};

module.exports = {
  createLink,
  escapeHtml,
  formatDiagnosis,
  formatDocument,
  formatRecord,
  formatVisitNotes,
  getStatus,
  handleUpdate,
  isEnabled,
  isValidWebhookSecret,
  sendRecordToOwner,
  sendTest,
  sendToUser,
  start,
  stop,
  unlink,
};
