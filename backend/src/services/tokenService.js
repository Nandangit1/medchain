const logger = require("../config/logger");
const { env } = require("../config/env");
const Token = require("../models/Token");
const { TOKEN_TYPES } = require("../models/Token");
const AppError = require("../utils/AppError");

/**
 * Token Service — refresh tokens and password resets.
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
const RESET_TTL_MINUTES = 30;

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

// --- Password reset --------------------------------------------------------

const issuePasswordResetToken = async (user, req) => {
  // One live reset at a time; requesting a new link invalidates the old one.
  await Token.updateMany(
    { user: user._id, type: TOKEN_TYPES.PASSWORD_RESET, usedAt: null, revokedAt: null },
    { revokedAt: new Date() }
  );

  const { raw, hash } = Token.generate();

  await Token.create({
    user: user._id,
    type: TOKEN_TYPES.PASSWORD_RESET,
    tokenHash: hash,
    expiresAt: new Date(Date.now() + RESET_TTL_MINUTES * 60 * 1000),
    ipAddress: req?.ip,
    userAgent: req?.headers?.["user-agent"]?.slice(0, 300),
  });

  return raw;
};

const consumePasswordResetToken = async (rawToken) => {
  const existing = await Token.findOne({
    tokenHash: Token.hash(rawToken),
    type: TOKEN_TYPES.PASSWORD_RESET,
  })
    .populate("user")
    .exec();

  if (!existing || !existing.isUsable() || !existing.user) {
    throw new AppError("This reset link is invalid or has expired.", 400);
  }

  existing.usedAt = new Date();
  await existing.save();

  return existing.user;
};

/** Cookie options for the refresh token. */
const refreshCookieOptions = () => ({
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  // Strict is what makes the CSRF surface on /refresh essentially nil.
  sameSite: "strict",
  path: "/api/v1/auth",
  maxAge: REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000,
});

module.exports = {
  REFRESH_TTL_DAYS,
  RESET_TTL_MINUTES,
  consumePasswordResetToken,
  issuePasswordResetToken,
  issueRefreshToken,
  refreshCookieOptions,
  revokeAllForUser,
  revokeRefreshToken,
  rotateRefreshToken,
};
