const crypto = require("crypto");

const {
  ABHA_ADDRESS_PATTERN,
  ABHA_NUMBER_PATTERN,
  formatAbhaNumber,
  normaliseAbhaNumber,
} = require("../constants/abdm");
const { env } = require("../config/env");
const logger = require("../config/logger");
const AppError = require("../utils/AppError");

/**
 * ABHA linking.
 *
 * Two drivers behind one interface, chosen by ABHA_DRIVER -- the same factory
 * shape the IPFS layer uses, and for the same reason: the National Health
 * Authority sandbox needs credentials and a registered client, which a marker
 * or an offline demo will not have.
 *
 *   mock     Validates format, verifies a deterministic OTP, links locally.
 *            Marks the link `verified: false`, because nothing was proven.
 *   nha      Calls the real ABDM gateway. Requires ABDM_CLIENT_ID/SECRET.
 *
 * The mock is honest about being a mock: it never sets `verified: true`, so a
 * demo can never be mistaken for a real identity check.
 */

/**
 * Verhoeff check digit, which is what the NHA actually uses to validate an
 * ABHA number. Implemented rather than imported: it is a published table
 * algorithm, and one small function beats a dependency.
 */
const D_TABLE = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];

const P_TABLE = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

const isValidVerhoeff = (digits) => {
  let checksum = 0;

  [...digits].reverse().forEach((digit, index) => {
    checksum = D_TABLE[checksum][P_TABLE[index % 8][Number(digit)]];
  });

  return checksum === 0;
};

const assertWellFormed = ({ abhaNumber, abhaAddress }) => {
  if (!ABHA_NUMBER_PATTERN.test(String(abhaNumber || ""))) {
    throw new AppError("An ABHA number is 14 digits, for example 12-3456-7890-1234.", 400);
  }

  if (!isValidVerhoeff(normaliseAbhaNumber(abhaNumber))) {
    throw new AppError("That ABHA number failed its checksum. Check the digits and try again.", 400);
  }

  if (abhaAddress && !ABHA_ADDRESS_PATTERN.test(String(abhaAddress))) {
    throw new AppError("An ABHA address looks like yourname@abdm.", 400);
  }
};

// --- Drivers ---------------------------------------------------------------

/**
 * Offline driver. The OTP is derived from the ABHA number and a server secret,
 * so it is stable for a given number within the demo but not guessable from
 * outside it. It proves the flow, not the identity.
 */
const mockDriver = {
  name: "mock",

  async requestOtp({ abhaNumber }) {
    assertWellFormed({ abhaNumber });

    const otp = crypto
      .createHmac("sha256", env.JWT_SECRET)
      .update(`abha:${normaliseAbhaNumber(abhaNumber)}`)
      .digest("hex")
      .replace(/\D/g, "")
      .slice(0, 6)
      .padEnd(6, "0");

    // Logged, never returned: the response must look exactly like the real
    // gateway's, which tells you nothing but "an OTP was sent".
    logger.info("ABHA OTP issued (mock driver)", { abhaNumber: formatAbhaNumber(abhaNumber), otp });

    return { transactionId: crypto.randomUUID(), sentTo: "the mobile linked to this ABHA" };
  },

  async verifyOtp({ abhaNumber, otp }) {
    const expected = await this.requestOtp({ abhaNumber });

    const recomputed = crypto
      .createHmac("sha256", env.JWT_SECRET)
      .update(`abha:${normaliseAbhaNumber(abhaNumber)}`)
      .digest("hex")
      .replace(/\D/g, "")
      .slice(0, 6)
      .padEnd(6, "0");

    if (String(otp) !== recomputed) {
      throw new AppError("That OTP is not valid.", 400);
    }

    return {
      // Never true on this driver: no identity was actually proven.
      verified: false,
      transactionId: expected.transactionId,
    };
  },
};

/**
 * Real ABDM gateway. Left as the integration point rather than a guess at the
 * wire format: the endpoints require a registered client id and secret, and
 * writing them blind would produce code that has never once been executed.
 */
const nhaDriver = {
  name: "nha",

  async requestOtp() {
    throw new AppError(
      "The ABDM gateway driver needs ABDM_CLIENT_ID and ABDM_CLIENT_SECRET from the NHA sandbox. Set ABHA_DRIVER=mock to use the offline flow.",
      501
    );
  },

  async verifyOtp() {
    throw new AppError("The ABDM gateway driver is not configured.", 501);
  },
};

const driver = env.ABHA_DRIVER === "nha" ? nhaDriver : mockDriver;

// --- Public API ------------------------------------------------------------

const requestOtp = ({ abhaNumber }) => driver.requestOtp({ abhaNumber });

/**
 * Completes the link. Returns the fields to persist rather than saving them,
 * so the caller owns the write and the audit entry that goes with it.
 */
const linkAbha = async ({ abhaNumber, abhaAddress, otp }) => {
  assertWellFormed({ abhaNumber, abhaAddress });

  const result = await driver.verifyOtp({ abhaNumber, otp });

  return {
    number: formatAbhaNumber(abhaNumber),
    address: abhaAddress || null,
    verified: result.verified,
    linkedAt: new Date(),
  };
};

const driverName = () => driver.name;

module.exports = { driverName, isValidVerhoeff, linkAbha, requestOtp };
