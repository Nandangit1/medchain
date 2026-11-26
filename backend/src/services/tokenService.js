const crypto = require("crypto");

const logger = require("../config/logger");
const { env } = require("../config/env");
const Token = require("../models/Token");
const { TOKEN_TYPES } = require("../models/Token");
const AppError = require("../utils/AppError");

/**
 * Token Service — refresh tokens and emailed password-reset codes.
 *
 * DESIGN, and why it is this way:
 *
 *   Access token   short-lived JWT, sent as a Bearer header, held in memory by
 *                  the browser. Never written to localStorage in the refresh
 *                  flow, so an XSS payload cannot simply read it and walk away
 *                  with a long-lived session.
 *
 *   Refresh token  32 random bytes in an httpOnly, SameSite=Strict cookie.
 *                  JavaScript cannot read it at all. Only its SHA-256 is
 *                  stored server-side.
 *
 *   Rotation       every refresh issues a NEW token and marks the old one
 *                  used. Presenting an already-used token means it leaked, so
 *                  the entire family is revoked and the user must sign in
 *                  again. This is the standard defence against replay of a
 *                  stolen refresh token.
 */
const REFRESH_TTL_DAYS = 7;

const issueRefreshToken = async (user, req) => {
  const { raw, hash } = Token.generate();

  await Token.create({
    user: user._id,
    type: TOKEN_TYPES.REFRESH,
    tokenHash: hash,
    expiresAt: new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000),
    ipAddress: req?.ip,
    userAgent: req?.headers?.["user-agent"]?.slice(0, 300),
  });

  return raw;
};

/**
 * Validates and rotates a refresh token.
 *
 * @returns {Promise<{ user: object, refreshToken: string }>}
 */
const rotateRefreshToken = async (rawToken, req) => {
  if (!rawToken) {
    throw new AppError("No refresh token was supplied.", 401);
  }

  const existing = await Token.findOne({
    tokenHash: Token.hash(rawToken),
    type: TOKEN_TYPES.REFRESH,
  })
    .populate("user")
    .exec();

  if (!existing) {
    throw new AppError("This session is no longer valid. Please sign in again.", 401);
  }

  /**
   * REUSE DETECTION. A used token being presented again means someone kept a
   * copy — either the legitimate client replayed it, or it was stolen. Either
   * way the safe response is to revoke every outstanding token for that user.
   */
  if (existing.usedAt) {
    await Token.updateMany(
      { user: existing.user._id, type: TOKEN_TYPES.REFRESH, revokedAt: null },
      { revokedAt: new Date() }
    );

    logger.warn("Refresh token reuse detected; all sessions revoked", {
      userId: String(existing.user._id),
      ip: req?.ip,
    });

    throw new AppError("This session was reused and has been revoked. Please sign in again.", 401);
  }

  if (!existing.isUsable()) {
    throw new AppError("This session has expired. Please sign in again.", 401);
  }

  if (!existing.user) {
    throw new AppError("The account for this session no longer exists.", 401);
  }

  const replacement = await issueRefreshToken(existing.user, req);

  existing.usedAt = new Date();
  existing.replacedBy = Token.hash(replacement);
  await existing.save();

  return { user: existing.user, refreshToken: replacement };
};

const revokeRefreshToken = async (rawToken) => {
  if (!rawToken) return false;

  const result = await Token.updateOne(
    { tokenHash: Token.hash(rawToken), type: TOKEN_TYPES.REFRESH, revokedAt: null },
    { revokedAt: new Date() }
  );

  return result.modifiedCount > 0;
};

const revokeAllForUser = (userId) =>
  Token.updateMany(
    { user: userId, type: TOKEN_TYPES.REFRESH, revokedAt: null },
    { revokedAt: new Date() }
  );

// --- Password reset by emailed one-time code --------------------------------

const OTP_TTL_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_SECONDS = 60;

/**
 * Keyed hash, not a bare SHA-256. A 6-digit code has a million values, so an
 * unkeyed digest leaked from the database could be reversed in milliseconds.
 * Binding the user id stops one digest from matching across accounts.
 */
const hashOtp = (userId, code) =>
  crypto.createHmac("sha256", env.JWT_SECRET).update(`${userId}:${code}`).digest("hex");

/**
 * Issues a fresh code and invalidates any earlier one.
 *
 * @returns {Promise<{ code: string } | { throttled: true }>} `throttled` when a
 *   code was sent within the cooldown, so the inbox is not flooded by someone
 *   pressing "resend" -- or by someone else typing your address.
 */
const issuePasswordResetOtp = async (user, req) => {
  const recent = await Token.findOne({
    user: user._id,
    type: TOKEN_TYPES.PASSWORD_RESET_OTP,
    createdAt: { $gt: new Date(Date.now() - OTP_RESEND_COOLDOWN_SECONDS * 1000) },
  }).exec();

  if (recent) return { throttled: true };

  await Token.updateMany(
    { user: user._id, type: TOKEN_TYPES.PASSWORD_RESET_OTP, usedAt: null, revokedAt: null },
    { revokedAt: new Date() }
  );

  // randomInt is uniform; Math.random is neither uniform enough nor unpredictable.
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");

  await Token.create({
    user: user._id,
    type: TOKEN_TYPES.PASSWORD_RESET_OTP,
    tokenHash: hashOtp(user._id, code),
    expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000),
    ipAddress: req?.ip,
    userAgent: req?.headers?.["user-agent"]?.slice(0, 300),
  });

  return { code };
};

/**
 * Checks a code and burns it on success. Every failure returns the same
 * message, so the response never reveals whether the address has an account,
 * whether a code was ever issued, or how many guesses remain.
 */
const consumePasswordResetOtp = async (user, code) => {
  const invalid = () => new AppError("That code is incorrect or has expired. Request a new one.", 400);

  if (!user) throw invalid();

  const existing = await Token.findOne({
    user: user._id,
    type: TOKEN_TYPES.PASSWORD_RESET_OTP,
    usedAt: null,
    revokedAt: null,
  })
    .sort({ createdAt: -1 })
    .exec();

  if (!existing || !existing.isUsable() || existing.attempts >= OTP_MAX_ATTEMPTS) {
    throw invalid();
  }

  const expected = Buffer.from(existing.tokenHash, "hex");
  const supplied = Buffer.from(hashOtp(user._id, String(code).trim()), "hex");

  if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) {
    existing.attempts += 1;
    if (existing.attempts >= OTP_MAX_ATTEMPTS) existing.revokedAt = new Date();
    await existing.save();
    throw invalid();
  }

  existing.usedAt = new Date();
  await existing.save();

  return user;
};

/** Cookie options for the refresh token. */
const refreshCookieOptions = () => ({
  httpOnly: true,
  /**
   * Keyed to actual TLS rather than NODE_ENV: a `secure` cookie is silently
   * dropped over plain http, which would break sessions on a production build
   * served without TLS (a LAN demo, for instance).
   */
  secure: env.TRUST_TLS,
  // Strict is what makes the CSRF surface on /refresh essentially nil.
  sameSite: "strict",
  path: "/api/v1/auth",
  maxAge: REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000,
});

module.exports = {
  OTP_MAX_ATTEMPTS,
  OTP_TTL_MINUTES,
  REFRESH_TTL_DAYS,
  consumePasswordResetOtp,
  issuePasswordResetOtp,
  issueRefreshToken,
  refreshCookieOptions,
  revokeAllForUser,
  revokeRefreshToken,
  rotateRefreshToken,
};
