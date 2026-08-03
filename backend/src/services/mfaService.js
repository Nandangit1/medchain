const crypto = require("crypto");

const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { generateSecret, generateURI, verify: verifyTotp } = require("otplib");
const qrcode = require("qrcode");

const { env } = require("../config/env");
const AppError = require("../utils/AppError");
const encryptionService = require("./encryptionService");

/**
 * Multi-Factor Authentication Service.
 *
 * TOTP (RFC 6238) via otplib, which is what Google Authenticator, Authy, Microsoft
 * Authenticator and every password manager already speak. No SMS: SIM-swap makes
 * it the weakest common second factor, and it costs money per message.
 *
 * The shared secret is the whole security of the scheme, so it is never stored
 * in the clear. It is sealed with the same AES-256-GCM envelope that protects
 * medical file keys — one master key, one place to rotate.
 */

/**
 * One 30-second step of slack each side. Phone clocks drift, and rejecting a
 * code the user is looking at right now is the fastest way to make people turn
 * the feature off. Expressed in seconds — otplib 13 takes a tolerance, not a
 * step count.
 */
const EPOCH_TOLERANCE_SECONDS = 30;

const BACKUP_CODE_COUNT = 10;
const CHALLENGE_TTL_SECONDS = 5 * 60;

/**
 * Between password and code the user is authenticated but not yet trusted, and
 * that state has to survive a stateless round trip. A short-lived JWT scoped to
 * `purpose: "mfa"` carries it, so it can never be presented as an access token.
 */
const issueChallengeToken = (user) =>
  jwt.sign({ id: String(user._id), purpose: "mfa" }, env.JWT_SECRET, {
    expiresIn: CHALLENGE_TTL_SECONDS,
  });

const verifyChallengeToken = (token) => {
  let payload;

  try {
    payload = jwt.verify(token, env.JWT_SECRET);
  } catch {
    throw new AppError("This sign-in attempt has expired. Please sign in again.", 401);
  }

  if (payload.purpose !== "mfa") {
    throw new AppError("Invalid verification token.", 401);
  }

  return payload.id;
};

/**
 * Sealed with the same envelope scheme as a medical file: a random content key
 * encrypts the secret, and the master key wraps that content key. Stored as one
 * string so the schema needs a single field rather than five.
 */
const sealSecret = (secret) => {
  const { ciphertext, envelope } = encryptionService.encryptBuffer(Buffer.from(secret, "utf8"));
  return JSON.stringify({ ...envelope, ciphertext: ciphertext.toString("hex") });
};

const openSecret = (sealed) => {
  try {
    const { ciphertext, ...envelope } = JSON.parse(sealed);
    return encryptionService.decryptBuffer(Buffer.from(ciphertext, "hex"), envelope).toString("utf8");
  } catch {
    // A secret that will not unseal is unusable; treating it as a hard failure
    // is safer than falling back to "no second factor required".
    throw new AppError("Stored authenticator secret could not be read.", 500);
  }
};

/**
 * Step one of enrolment. The secret is returned so it can be shown as a QR
 * code, but it is not activated until a code proves the phone actually has it —
 * otherwise a mistyped scan locks the user out of their own account.
 */
const beginEnrolment = async ({ user }) => {
  const secret = generateSecret();
  const otpauth = generateURI({
    strategy: "totp",
    issuer: "MedChain",
    label: user.email,
    secret,
  });

  return {
    sealedSecret: sealSecret(secret),
    otpauth,
    // Rendered server-side so the raw secret never has to be handed to a
    // third-party QR service or a client-side library.
    qrDataUrl: await qrcode.toDataURL(otpauth, { margin: 1, width: 240 }),
    // Shown as a fallback for authenticator apps that cannot scan.
    manualEntryKey: secret.replace(/(.{4})/g, "$1 ").trim(),
  };
};

const verifyCode = async ({ sealedSecret, code }) => {
  const token = String(code || "").replace(/\s/g, "");

  // Backup codes reach this function too; they are not six digits, so they are
  // rejected here and matched by matchBackupCode instead.
  if (!/^\d{6}$/.test(token) || !sealedSecret) {
    return false;
  }

  const result = await verifyTotp({
    secret: openSecret(sealedSecret),
    token,
    epochTolerance: EPOCH_TOLERANCE_SECONDS,
  });

  return result.valid === true;
};

/**
 * Single-use codes for a lost or wiped phone. Hashed like passwords, because a
 * database leak would otherwise hand over a permanent MFA bypass.
 */
const generateBackupCodes = async () => {
  const plain = Array.from({ length: BACKUP_CODE_COUNT }, () =>
    crypto.randomBytes(5).toString("hex").toUpperCase().replace(/(.{5})/, "$1-")
  );

  const hashed = await Promise.all(plain.map((code) => bcrypt.hash(code, 10)));

  return { plain, hashed };
};

/**
 * @returns the index of the code that matched, or -1. The caller must remove
 *          that entry — a backup code that survives one use is a static password.
 */
const matchBackupCode = async ({ candidate, hashedCodes = [] }) => {
  const normalised = String(candidate || "").trim().toUpperCase();

  for (let index = 0; index < hashedCodes.length; index += 1) {
    // Sequential on purpose: bcrypt is deliberately slow, and firing ten
    // comparisons at once would spike CPU on every failed attempt.
    if (await bcrypt.compare(normalised, hashedCodes[index])) {
      return index;
    }
  }

  return -1;
};

/**
 * Clinicians and operators hold other people's data; patients hold only their
 * own. That asymmetry is why MFA is required for one group and offered to the
 * other. Enforcement stays opt-in via MFA_ENFORCED so that turning the feature
 * on cannot lock an existing deployment out of its own admin account.
 */
const isRequiredFor = (user) => env.MFA_REQUIRED_ROLES.includes(user.role);

const isEnforced = () => env.MFA_ENFORCED;

module.exports = {
  CHALLENGE_TTL_SECONDS,
  beginEnrolment,
  generateBackupCodes,
  isEnforced,
  isRequiredFor,
  issueChallengeToken,
  matchBackupCode,
  sealSecret,
  verifyChallengeToken,
  verifyCode,
};
