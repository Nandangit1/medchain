const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { detectMimeType, verifyFileSignature } = require("../src/utils/fileSignature");

/**
 * Content-based file type verification.
 *
 * The MIME allow-list alone proves nothing: `file.mimetype` comes from the
 * client's Content-Type header and is trivially spoofable. These tests cover
 * the case that matters — bytes that disagree with the declared type.
 */

/** Minimal but structurally real file headers. */
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n", "utf8");
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);
const WEBP = Buffer.concat([
  Buffer.from("RIFF", "ascii"),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from("WEBP", "ascii"),
  Buffer.alloc(16),
]);
const TIFF_LE = Buffer.concat([Buffer.from([0x49, 0x49, 0x2a, 0x00]), Buffer.alloc(16)]);
const TIFF_BE = Buffer.concat([Buffer.from([0x4d, 0x4d, 0x00, 0x2a]), Buffer.alloc(16)]);
const DICOM = Buffer.concat([Buffer.alloc(128), Buffer.from("DICM", "ascii"), Buffer.alloc(16)]);
const TEXT = Buffer.from("Haemoglobin 9.1 g/dL\nBelow reference range.\n", "utf8");

/** A Windows executable — the classic thing an attacker relabels as a PDF. */
const EXE = Buffer.concat([Buffer.from([0x4d, 0x5a, 0x90, 0x00]), Buffer.alloc(64)]);
const ELF = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(64)]);
const ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(64)]);

describe("Unit — file signature verification", () => {
  describe("accepts genuine files", () => {
    const cases = [
      ["application/pdf", PDF],
      ["image/png", PNG],
      ["image/jpeg", JPEG],
      ["image/webp", WEBP],
      ["image/tiff", TIFF_LE],
      ["image/tiff", TIFF_BE],
      ["application/dicom", DICOM],
      ["text/plain", TEXT],
    ];

    cases.forEach(([mimeType, buffer]) => {
      it(`accepts ${mimeType}`, () => {
        const result = verifyFileSignature(buffer, mimeType);
        assert.equal(result.valid, true, result.reason);
      });
    });
  });

  describe("REJECTS spoofed content", () => {
    it("rejects a Windows executable declared as a PDF", () => {
      const result = verifyFileSignature(EXE, "application/pdf");

      assert.equal(result.valid, false);
      assert.match(result.detected, /executable/i, "the real type should be named");
      assert.match(result.reason, /declared as application\/pdf/);
    });

    it("rejects a Linux executable declared as an image", () => {
      const result = verifyFileSignature(ELF, "image/png");

      assert.equal(result.valid, false);
      assert.match(result.detected, /elf/i);
    });

    it("rejects a zip archive declared as a PDF", () => {
      const result = verifyFileSignature(ZIP, "application/pdf");

      assert.equal(result.valid, false);
      assert.match(result.detected, /zip/);
    });

    it("rejects a PNG declared as a PDF", () => {
      // Not malicious, just wrong — most often a renamed file.
      const result = verifyFileSignature(PNG, "application/pdf");

      assert.equal(result.valid, false);
      assert.equal(result.detected, "image/png");
    });

    it("rejects binary content declared as plain text", () => {
      const result = verifyFileSignature(EXE, "text/plain");

      assert.equal(result.valid, false);
      assert.match(result.reason, /binary/i);
    });

    it("rejects text containing NUL bytes", () => {
      // A NUL in the first kilobyte is the classic binary-vs-text signal.
      const sneaky = Buffer.concat([Buffer.from("hello"), Buffer.from([0x00]), Buffer.from("x")]);

      assert.equal(verifyFileSignature(sneaky, "text/plain").valid, false);
    });
  });

  describe("edge cases", () => {
    it("rejects an empty buffer", () => {
      const result = verifyFileSignature(Buffer.alloc(0), "application/pdf");

      assert.equal(result.valid, false);
      assert.match(result.reason, /empty/i);
    });

    it("rejects a non-buffer", () => {
      assert.equal(verifyFileSignature(null, "application/pdf").valid, false);
    });

    it("rejects a buffer too short to hold the signature", () => {
      // "%P" alone must not pass as a PDF.
      assert.equal(verifyFileSignature(Buffer.from("%P"), "application/pdf").valid, false);
    });

    it("rejects a DICOM whose preamble is too short", () => {
      const truncated = Buffer.concat([Buffer.alloc(64), Buffer.from("DICM", "ascii")]);

      assert.equal(verifyFileSignature(truncated, "application/dicom").valid, false);
    });

    it("rejects an unsupported declared type", () => {
      assert.equal(verifyFileSignature(PDF, "application/x-msdownload").valid, false);
    });

    it("honours WebP wildcard bytes regardless of the size field", () => {
      const other = Buffer.concat([
        Buffer.from("RIFF", "ascii"),
        Buffer.from([0xff, 0xee, 0xdd, 0xcc]), // any size
        Buffer.from("WEBP", "ascii"),
        Buffer.alloc(8),
      ]);

      assert.equal(verifyFileSignature(other, "image/webp").valid, true);
    });

    it("does not mistake a RIFF container that is not WebP", () => {
      const wav = Buffer.concat([
        Buffer.from("RIFF", "ascii"),
        Buffer.from([0x24, 0x00, 0x00, 0x00]),
        Buffer.from("WAVE", "ascii"),
        Buffer.alloc(8),
      ]);

      assert.equal(verifyFileSignature(wav, "image/webp").valid, false);
    });
  });

  describe("detectMimeType", () => {
    it("identifies known formats from content alone", () => {
      assert.equal(detectMimeType(PDF), "application/pdf");
      assert.equal(detectMimeType(PNG), "image/png");
      assert.equal(detectMimeType(JPEG), "image/jpeg");
      assert.equal(detectMimeType(DICOM), "application/dicom");
    });

    it("returns null for unrecognised content", () => {
      assert.equal(detectMimeType(Buffer.from("just some words")), null);
    });
  });
});
