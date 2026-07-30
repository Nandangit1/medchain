const crypto = require("crypto");
const mongoose = require("mongoose");

const TOKEN_TYPES = Object.freeze({
  REFRESH: "refresh",
  PASSWORD_RESET: "password_reset",
});

/**
 * Server-side token store for refresh and password-reset tokens.
 *
 * ONLY THE SHA-256 OF THE TOKEN IS STORED. The raw value is returned to the
 * client once and never persisted, so a database dump cannot be replayed to
 * hijack sessions or reset passwords — the same reasoning that applies to
 * password hashing.
 *
 * SHA-256 rather than bcrypt is correct here: these tokens are 32 bytes of
 * cryptographic randomness, not low-entropy human input, so there is nothing
 * for a slow hash to defend against, and refresh happens on a hot path.
 */
const tokenSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: Object.values(TOKEN_TYPES),
      required: true,
    },
    tokenHash: {
      type: String,
      required: true,
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    usedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },

    /** Set when a refresh token is rotated, so reuse can be detected. */
    replacedBy: { type: String, default: null },

    ipAddress: { type: String, trim: true },
    userAgent: { type: String, trim: true, maxlength: 300 },
  },
  { timestamps: true }
);

/** MongoDB reaps expired documents automatically. */
tokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
tokenSchema.index({ user: 1, type: 1 });

tokenSchema.methods.isUsable = function isUsable() {
  return !this.usedAt && !this.revokedAt && this.expiresAt.getTime() > Date.now();
};

/** Generates a raw token and its stored hash. The raw value is never persisted. */
tokenSchema.statics.generate = function generate() {
  const raw = crypto.randomBytes(32).toString("hex");
  return { raw, hash: crypto.createHash("sha256").update(raw).digest("hex") };
};

tokenSchema.statics.hash = function hashToken(raw) {
  return crypto.createHash("sha256").update(String(raw)).digest("hex");
};

const Token = mongoose.model("Token", tokenSchema);

module.exports = Token;
module.exports.TOKEN_TYPES = TOKEN_TYPES;
