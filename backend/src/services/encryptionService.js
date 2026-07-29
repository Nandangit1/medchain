const crypto = require("crypto");

const { env } = require("../config/env");
const AppError = require("../utils/AppError");

const ALGORITHM = "aes-256-gcm";
const CONTENT_KEY_BYTES = 32;
const IV_BYTES = 12; // 96-bit nonce, the value NIST SP 800-38D recommends for GCM.

/**
 * Envelope Encryption Service.
 *
 * Why two layers of keys instead of encrypting every file with one master key:
 *
 *   1. Key separation. Each record gets its own random content-encryption key
 *      (CEK), so compromising one file's key exposes exactly one file.
 *   2. Nonce safety. GCM catastrophically loses confidentiality if the same
 *      (key, IV) pair is ever reused. A fresh random CEK per file makes an IV
 *      collision across files harmless.
 *   3. Rotation. The master key can be rotated by re-wrapping the small
 *      `wrappedKey` blobs, without re-encrypting or re-uploading any file.
 *
 * The master key never leaves this module, and the CEK exists in memory only
 * for the duration of a single request.
 */
const getMasterKey = () => Buffer.from(env.FILE_ENCRYPTION_KEY, "hex");

/** Seals the per-file content key with the master key. */
const wrapContentKey = (contentKey) => {
  const keyIv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, getMasterKey(), keyIv);

  const wrappedKey = Buffer.concat([cipher.update(contentKey), cipher.final()]);

  return {
    wrappedKey: wrappedKey.toString("hex"),
    keyIv: keyIv.toString("hex"),
    keyAuthTag: cipher.getAuthTag().toString("hex"),
  };
};

const unwrapContentKey = ({ wrappedKey, keyIv, keyAuthTag }) => {
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    getMasterKey(),
    Buffer.from(keyIv, "hex")
  );
  decipher.setAuthTag(Buffer.from(keyAuthTag, "hex"));

  return Buffer.concat([decipher.update(Buffer.from(wrappedKey, "hex")), decipher.final()]);
};

/**
 * Encrypts a plaintext buffer and returns the ciphertext together with the
 * envelope that must be persisted to make it recoverable.
 *
 * @param {Buffer} plaintext
 * @returns {{ ciphertext: Buffer, envelope: object }}
 */
const encryptBuffer = (plaintext) => {
  if (!Buffer.isBuffer(plaintext) || plaintext.length === 0) {
    throw new AppError("Cannot encrypt an empty file buffer.", 400);
  }

  const contentKey = crypto.randomBytes(CONTENT_KEY_BYTES);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, contentKey, iv);

  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const envelope = {
    algorithm: ALGORITHM,
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
    ...wrapContentKey(contentKey),
  };

  // The content key has served its purpose; do not leave it in memory.
  contentKey.fill(0);

  return { ciphertext, envelope };
};

/**
 * Reverses `encryptBuffer`. A failed GCM authentication tag means the stored
 * bytes were altered, so it is surfaced as a tamper error rather than a
 * generic 500.
 *
 * @param {Buffer} ciphertext
 * @param {object} envelope
 * @returns {Buffer} plaintext
 */
const decryptBuffer = (ciphertext, envelope) => {
  if (!envelope) {
    throw new AppError("This record is missing its encryption metadata and cannot be decrypted.", 500);
  }

  try {
    const contentKey = unwrapContentKey(envelope);

    const decipher = crypto.createDecipheriv(
      envelope.algorithm || ALGORITHM,
      contentKey,
      Buffer.from(envelope.iv, "hex")
    );
    decipher.setAuthTag(Buffer.from(envelope.authTag, "hex"));

    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    contentKey.fill(0);

    return plaintext;
  } catch {
    /**
     * The underlying error is deliberately not surfaced. A failed GCM tag and
     * a malformed envelope are indistinguishable to a caller, and leaking
     * crypto internals into an API response tells an attacker which of their
     * guesses was closer.
     */
    throw new AppError(
      "Decryption failed: the stored file failed its authenticity check and may have been tampered with.",
      422
    );
  }
};

module.exports = {
  ALGORITHM,
  decryptBuffer,
  encryptBuffer,
};
