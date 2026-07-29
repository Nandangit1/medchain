const crypto = require("crypto");

const BASE32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

/**
 * RFC 4648 base32, lower-case and unpadded, which is what multibase prefix
 * "b" denotes. Implemented locally to avoid pulling the full multiformats
 * dependency tree into the backend for a single encoding step.
 */
const base32Encode = (buffer) => {
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
};

/**
 * Builds a CIDv1 for the supplied bytes using the raw codec and sha2-256.
 *
 * Byte layout: <version 0x01><codec raw 0x55><sha2-256 0x12><length 0x20><digest>
 *
 * NOTE: a real IPFS node stores payloads larger than its chunk size (256 KiB
 * by default) as a chunked UnixFS DAG, whose root CID differs from this
 * single-block raw CID. The identifier produced here is therefore a valid,
 * self-verifying content address for the local driver, but it is not
 * guaranteed to equal the CID Kubo would emit for the same large file. The
 * Pinata driver always returns the authoritative CID from the network.
 */
const toRawCidV1 = (buffer) => {
  const digest = crypto.createHash("sha256").update(buffer).digest();
  const cidBytes = Buffer.concat([Buffer.from([0x01, 0x55, 0x12, 0x20]), digest]);

  return `b${base32Encode(cidBytes)}`;
};

module.exports = {
  base32Encode,
  toRawCidV1,
};
