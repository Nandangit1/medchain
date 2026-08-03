const nodemailer = require("nodemailer");

const { env } = require("../config/env");
const logger = require("../config/logger");

/**
 * Mail Service.
 *
 * Outbound email, kept behind the same shape as the rest of the service layer:
 * nothing above this file knows whether a transport is configured.
 *
 * Delivery is best-effort by design. `send` never throws — an SMTP outage must
 * not roll back the upload, the grant, or the password reset that triggered
 * the mail. Callers that need to know use the returned `delivered` flag.
 *
 * With MAIL_ENABLED=false (the default) the message is written to the log
 * instead of sent, which keeps every flow demonstrable offline and keeps the
 * test suite from needing a mail server.
 */

let transporter = null;
let verified = false;

const isEnabled = () => env.MAIL_ENABLED && Boolean(env.SMTP_HOST);

/**
 * Built once and reused: nodemailer pools connections, and re-creating the
 * transport per message would open a new TCP+TLS session every time.
 */
const getTransporter = () => {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    // 465 is implicit TLS; 587 upgrades with STARTTLS after the greeting.
    secure: env.SMTP_PORT === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
    pool: true,
    maxConnections: 3,
  });

  return transporter;
};

/**
 * A plain-text part is always sent alongside the HTML. Some clients refuse to
 * render HTML-only mail, and spam filters score it worse.
 */
const stripHtml = (html) =>
  String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h1|h2|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/**
 * House style for every message. Inline CSS only: Gmail and Outlook strip
 * <style> blocks, so a stylesheet would simply not arrive.
 */
const wrap = ({ title, body, action }) => {
  const button = action
    ? `<p style="margin:28px 0;">
         <a href="${action.url}"
            style="background:#0f766e;color:#ffffff;text-decoration:none;padding:12px 22px;
                   border-radius:8px;font-weight:600;display:inline-block;">${action.label}</a>
       </p>
       <p style="color:#64748b;font-size:13px;line-height:1.6;">
         If the button does not work, paste this into your browser:<br>
         <span style="color:#0f766e;word-break:break-all;">${action.url}</span>
       </p>`
    : "";

  return `<div style="background:#f1f5f9;padding:32px 16px;font-family:'Segoe UI',Roboto,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:14px;
              padding:32px;border:1px solid #e2e8f0;">
    <p style="margin:0 0 4px;font-size:18px;font-weight:700;color:#0f766e;">MedChain</p>
    <p style="margin:0 0 24px;font-size:12px;color:#94a3b8;">Secure telemedicine</p>
    <h1 style="margin:0 0 16px;font-size:20px;color:#0f172a;">${title}</h1>
    <div style="font-size:15px;line-height:1.65;color:#334155;">${body}</div>
    ${button}
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:28px 0 16px;">
    <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.6;">
      Sent by MedChain because of activity on your account.
      This mailbox is not monitored.
    </p>
  </div>
</div>`;
};

/**
 * @returns {Promise<{delivered: boolean, reason?: string}>}
 */
const send = async ({ to, subject, title, body, action }) => {
  const html = wrap({ title, body, action });

  if (!isEnabled()) {
    // The reset link has to remain recoverable when no transport is set up,
    // otherwise an offline demo has no way back into a locked-out account.
    logger.info("Mail suppressed (MAIL_ENABLED=false)", {
      to,
      subject,
      preview: stripHtml(html).slice(0, 400),
    });
    return { delivered: false, reason: "mail_disabled" };
  }

  try {
    // Verified once per process: a bad password should surface as a clear log
    // line at first send rather than as a silent failure on every message.
    if (!verified) {
      await getTransporter().verify();
      verified = true;
      logger.info("SMTP transport ready", { host: env.SMTP_HOST, port: env.SMTP_PORT });
    }

    const info = await getTransporter().sendMail({
      from: env.MAIL_FROM,
      to,
      subject,
      html,
      text: stripHtml(html),
    });

    logger.info("Mail sent", { to, subject, messageId: info.messageId });
    return { delivered: true };
  } catch (error) {
    logger.error("Mail delivery failed", { to, subject, reason: error.message });
    return { delivered: false, reason: error.message };
  }
};

module.exports = { isEnabled, send };
