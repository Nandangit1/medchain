const crypto = require("crypto");

const sha256Hex = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

/**
 * Constant-time comparison so that integrity verification cannot be probed
 * byte-by-byte through response timing.
 */
const hashesMatch = (expectedHex, actualHex) => {
  if (typeof expectedHex !== "string" || typeof actualHex !== "string") {
    return false;
  }

  const expected = Buffer.from(expectedHex, "hex");
  const actual = Buffer.from(actualHex, "hex");

  if (expected.length !== actual.length || expected.length === 0) {
    return false;
  }

  return crypto.timingSafeEqual(expected, actual);
};

module.exports = {
  hashesMatch,
  sha256Hex,
};
