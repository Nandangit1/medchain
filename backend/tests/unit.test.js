const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { describe, it } = require("node:test");

/**
 * Unit tests for the pure functions.
 *
 * These need no server, no database and no chain — they exercise the crypto and
 * utility layers directly, so a regression here is caught in milliseconds
 * rather than being inferred from a failing integration test.
 *
 *   node -r dotenv/config --test "tests/unit.test.js"
 */
const encryptionService = require("../src/services/encryptionService");
const { base32Encode, toRawCidV1 } = require("../src/utils/cid");
const { hashesMatch, sha256Hex } = require("../src/utils/hash");
const { buildPagination, buildPaginationMeta, buildSort } = require("../src/utils/pagination");

describe("Unit — hash utilities", () => {
  it("computes a known SHA-256 digest", () => {
    // The canonical test vector for the empty string.
    assert.equal(
      sha256Hex(Buffer.from("")),
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );

    assert.equal(
      sha256Hex(Buffer.from("abc")),
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
  });

  it("matches identical digests", () => {
    const digest = sha256Hex(Buffer.from("medical report"));
    assert.equal(hashesMatch(digest, digest), true);
  });

  it("rejects a digest that differs by one bit", () => {
    const a = sha256Hex(Buffer.from("report"));
    const b = sha256Hex(Buffer.from("reporT"));
    assert.equal(hashesMatch(a, b), false);
  });

  it("rejects malformed and empty input rather than throwing", () => {
    const digest = sha256Hex(Buffer.from("x"));

    assert.equal(hashesMatch(digest, ""), false);
    assert.equal(hashesMatch("", ""), false);
    assert.equal(hashesMatch(digest, null), false);
    assert.equal(hashesMatch(undefined, digest), false);
    // Different lengths must not reach timingSafeEqual, which would throw.
    assert.equal(hashesMatch(digest, digest.slice(0, 32)), false);
  });
});

describe("Unit — CID generation", () => {
  it("encodes base32 per RFC 4648, lower-case and unpadded", () => {
    assert.equal(base32Encode(Buffer.from("f")), "my");
    assert.equal(base32Encode(Buffer.from("fo")), "mzxq");
    assert.equal(base32Encode(Buffer.from("foobar")), "mzxw6ytboi");
  });

  it("produces a CIDv1 with the expected multibase prefix", () => {
    const cid = toRawCidV1(Buffer.from("hello"));

    assert.match(cid, /^b[a-z2-7]+$/, "multibase 'b' + base32 lower, unpadded");
    // 4 header bytes + 32 digest = 36 bytes → 58 base32 chars, plus prefix.
    assert.equal(cid.length, 59);
  });

  it("is deterministic — the same bytes always give the same CID", () => {
    const payload = Buffer.from("identical content");
    assert.equal(toRawCidV1(payload), toRawCidV1(Buffer.from("identical content")));
  });

  it("differs for different content", () => {
    assert.notEqual(toRawCidV1(Buffer.from("a")), toRawCidV1(Buffer.from("b")));
  });

  it("embeds the sha2-256 multihash header", () => {
    /**
     * Decoding the base32 back to bytes must yield
     * <0x01 version><0x55 raw><0x12 sha2-256><0x20 length><digest>.
     */
    const ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
    const cid = toRawCidV1(Buffer.from("verify header"));

    let bits = 0;
    let value = 0;
    const bytes = [];

    for (const char of cid.slice(1)) {
      value = (value << 5) | ALPHABET.indexOf(char);
      bits += 5;

      if (bits >= 8) {
        bytes.push((value >>> (bits - 8)) & 0xff);
        bits -= 8;
      }
    }

    assert.deepEqual(bytes.slice(0, 4), [0x01, 0x55, 0x12, 0x20]);
    assert.equal(
      Buffer.from(bytes.slice(4)).toString("hex"),
      crypto.createHash("sha256").update(Buffer.from("verify header")).digest("hex")
    );
  });
});

describe("Unit — envelope encryption", () => {
  const plaintext = Buffer.from("Haemoglobin 9.1 g/dL — below reference range.");

  it("round-trips a buffer unchanged", () => {
    const { ciphertext, envelope } = encryptionService.encryptBuffer(plaintext);
    const recovered = encryptionService.decryptBuffer(ciphertext, envelope);

    assert.equal(recovered.toString(), plaintext.toString());
  });

  it("produces ciphertext that does not contain the plaintext", () => {
    const { ciphertext } = encryptionService.encryptBuffer(plaintext);

    assert.notEqual(ciphertext.toString("hex"), plaintext.toString("hex"));
    assert.ok(!ciphertext.includes(Buffer.from("Haemoglobin")));
  });

  it("emits a complete envelope", () => {
    const { envelope } = encryptionService.encryptBuffer(plaintext);

    assert.equal(envelope.algorithm, "aes-256-gcm");
    assert.match(envelope.iv, /^[0-9a-f]{24}$/, "12-byte IV");
    assert.match(envelope.authTag, /^[0-9a-f]{32}$/, "16-byte tag");
    assert.match(envelope.keyIv, /^[0-9a-f]{24}$/);
    assert.match(envelope.keyAuthTag, /^[0-9a-f]{32}$/);
    assert.match(envelope.wrappedKey, /^[0-9a-f]{64}$/, "32-byte wrapped CEK");
  });

  it("uses a DIFFERENT content key and IV for every call", () => {
    /**
     * This is the property that makes the envelope scheme worth its complexity:
     * GCM catastrophically loses confidentiality if a (key, IV) pair repeats.
     */
    const a = encryptionService.encryptBuffer(plaintext);
    const b = encryptionService.encryptBuffer(plaintext);

    assert.notEqual(a.envelope.iv, b.envelope.iv);
    assert.notEqual(a.envelope.wrappedKey, b.envelope.wrappedKey);
    // Identical plaintext must not produce identical ciphertext.
    assert.notEqual(a.ciphertext.toString("hex"), b.ciphertext.toString("hex"));
  });

  it("REJECTS ciphertext whose authentication tag no longer matches", () => {
    const { ciphertext, envelope } = encryptionService.encryptBuffer(plaintext);

    const tampered = Buffer.from(ciphertext);
    tampered[Math.floor(tampered.length / 2)] ^= 0xff;

    assert.throws(
      () => encryptionService.decryptBuffer(tampered, envelope),
      (error) => error.statusCode === 422 && /authenticity/i.test(error.message)
    );
  });

  it("REJECTS a tampered authentication tag", () => {
    const { ciphertext, envelope } = encryptionService.encryptBuffer(plaintext);
    const forged = { ...envelope, authTag: "0".repeat(32) };

    assert.throws(() => encryptionService.decryptBuffer(ciphertext, forged), {
      statusCode: 422,
    });
  });

  it("REJECTS a tampered wrapped key", () => {
    const { ciphertext, envelope } = encryptionService.encryptBuffer(plaintext);
    const forged = { ...envelope, wrappedKey: "a".repeat(64) };

    assert.throws(() => encryptionService.decryptBuffer(ciphertext, forged), {
      statusCode: 422,
    });
  });

  it("refuses to encrypt an empty buffer", () => {
    assert.throws(() => encryptionService.encryptBuffer(Buffer.alloc(0)), { statusCode: 400 });
    assert.throws(() => encryptionService.encryptBuffer(null), { statusCode: 400 });
  });

  it("reports a missing envelope distinctly from a tamper", () => {
    const { ciphertext } = encryptionService.encryptBuffer(plaintext);

    assert.throws(() => encryptionService.decryptBuffer(ciphertext, null), {
      statusCode: 500,
    });
  });

  it("handles a payload larger than one AES block", () => {
    const large = crypto.randomBytes(200 * 1024);
    const { ciphertext, envelope } = encryptionService.encryptBuffer(large);

    assert.equal(
      encryptionService.decryptBuffer(ciphertext, envelope).toString("hex"),
      large.toString("hex")
    );
  });
});

describe("Unit — pagination", () => {
  it("applies defaults", () => {
    assert.deepEqual(buildPagination({}), { page: 1, limit: 10, skip: 0 });
  });

  it("computes skip from page and limit", () => {
    assert.deepEqual(buildPagination({ page: "3", limit: "20" }), {
      page: 3,
      limit: 20,
      skip: 40,
    });
  });

  it("caps the limit at 100", () => {
    assert.equal(buildPagination({ limit: "5000" }).limit, 100);
  });

  it("falls back on nonsense input rather than producing NaN", () => {
    // A NaN skip would silently return an empty page.
    assert.deepEqual(buildPagination({ page: "abc", limit: "-4" }), {
      page: 1,
      limit: 10,
      skip: 0,
    });
    assert.deepEqual(buildPagination({ page: "0" }), { page: 1, limit: 10, skip: 0 });
  });

  it("builds coherent metadata", () => {
    const meta = buildPaginationMeta(45, { page: 2, limit: 10, skip: 10 });

    assert.deepEqual(meta, {
      totalItems: 45,
      totalPages: 5,
      currentPage: 2,
      limit: 10,
      hasNextPage: true,
      hasPreviousPage: true,
    });
  });

  it("reports at least one page when there are no items", () => {
    const meta = buildPaginationMeta(0, { page: 1, limit: 10, skip: 0 });

    assert.equal(meta.totalPages, 1);
    assert.equal(meta.hasNextPage, false);
    assert.equal(meta.hasPreviousPage, false);
  });

  it("marks the last page correctly", () => {
    const meta = buildPaginationMeta(20, { page: 2, limit: 10, skip: 10 });

    assert.equal(meta.hasNextPage, false);
    assert.equal(meta.hasPreviousPage, true);
  });
});

describe("Unit — sort allow-list", () => {
  const allowed = ["createdAt", "title"];

  it("defaults when no sort is supplied", () => {
    assert.deepEqual(buildSort(undefined, allowed), { createdAt: -1 });
  });

  it("sorts ascending on a bare field name", () => {
    assert.deepEqual(buildSort("title", allowed), { title: 1 });
  });

  it("sorts descending on a leading hyphen", () => {
    assert.deepEqual(buildSort("-title", allowed), { title: -1 });
  });

  it("IGNORES a field that is not on the allow-list", () => {
    /**
     * The security point: without this, a client could order results by a field
     * excluded from the projection and infer its values from the ordering.
     */
    assert.deepEqual(buildSort("password", allowed), { createdAt: -1 });
    assert.deepEqual(buildSort("-encryption.wrappedKey", allowed), { createdAt: -1 });
  });

  it("ignores non-string input", () => {
    assert.deepEqual(buildSort({ $ne: null }, allowed), { createdAt: -1 });
    assert.deepEqual(buildSort(42, allowed), { createdAt: -1 });
  });

  it("honours a custom fallback", () => {
    assert.deepEqual(buildSort(null, allowed, { title: 1 }), { title: 1 });
  });
});
