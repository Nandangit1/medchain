/**
 * File-type verification by content, not by declared type.
 *
 * WHY THIS EXISTS: `file.mimetype` from Multer is taken from the client's
 * Content-Type header. It is trivially spoofable — an attacker can upload an
 * executable and label it application/pdf. The MIME allow-list alone therefore
 * proves nothing about what was actually uploaded.
 *
 * These signatures ("magic bytes") are the first few bytes of the real file
 * format, so they cannot be forged without genuinely producing that format.
 *
 * This is defence in depth, not the only barrier: files are encrypted before
 * storage, are never executed, and are served with X-Content-Type-Options:
 * nosniff. It closes the gap where a declared type and the real bytes disagree.
 */

/**
 * @typedef {object} Signature
 * @property {number[]|null} bytes  expected byte values; null entries are wildcards
 * @property {number} offset        where the signature begins
 */

/** Each MIME type maps to the signatures that legitimately produce it. */
const SIGNATURES = {
  "application/pdf": [
    // "%PDF"
    { offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] },
  ],

  "image/png": [
    // \x89 P N G \r \n \x1a \n
    { offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  ],

  "image/jpeg": [
    // SOI marker; the third byte varies by encoder segment
    { offset: 0, bytes: [0xff, 0xd8, 0xff] },
  ],

  "image/webp": [
    // "RIFF" .... "WEBP" — the four size bytes between are wildcards
    {
      offset: 0,
      bytes: [0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x57, 0x45, 0x42, 0x50],
    },
  ],

  "image/tiff": [
    // Little-endian "II*\0"
    { offset: 0, bytes: [0x49, 0x49, 0x2a, 0x00] },
    // Big-endian "MM\0*"
    { offset: 0, bytes: [0x4d, 0x4d, 0x00, 0x2a] },
  ],

  "application/dicom": [
    // "DICM" sits after a 128-byte preamble, which is the format's quirk
    { offset: 128, bytes: [0x44, 0x49, 0x43, 0x4d] },
  ],
};

/**
 * Plain text has no signature by definition, so it is validated differently:
 * by confirming the bytes are plausible text rather than binary.
 */
const SIGNATURE_FREE_TYPES = new Set(["text/plain"]);

const matchesSignature = (buffer, signature) => {
  const end = signature.offset + signature.bytes.length;
  if (buffer.length < end) {
    return false;
  }

  return signature.bytes.every(
    (expected, index) => expected === null || buffer[signature.offset + index] === expected
  );
};

/**
 * Heuristic for plain text: reject NUL bytes and an implausible share of
 * non-printable characters. A NUL in the first kilobyte is the classic
 * binary-vs-text discriminator (it is what `git` and `file` both use).
 */
const looksLikeText = (buffer) => {
  const sample = buffer.subarray(0, Math.min(buffer.length, 1024));

  if (sample.includes(0x00)) {
    return false;
  }

  let suspicious = 0;

  for (const byte of sample) {
    const isPrintable = byte >= 0x20 && byte <= 0x7e;
    const isCommonWhitespace = byte === 0x09 || byte === 0x0a || byte === 0x0d;
    // Bytes >= 0x80 are accepted as possible UTF-8 continuation bytes.
    const isHighBit = byte >= 0x80;

    if (!isPrintable && !isCommonWhitespace && !isHighBit) {
      suspicious += 1;
    }
  }

  return suspicious / sample.length < 0.1;
};

/**
 * Confirms a buffer's real format matches its declared MIME type.
 *
 * @param {Buffer} buffer
 * @param {string} declaredMimeType
 * @returns {{ valid: boolean, reason?: string, detected?: string }}
 */
const verifyFileSignature = (buffer, declaredMimeType) => {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return { valid: false, reason: "The uploaded file is empty." };
  }

  if (SIGNATURE_FREE_TYPES.has(declaredMimeType)) {
    return looksLikeText(buffer)
      ? { valid: true, detected: declaredMimeType }
      : {
          valid: false,
          reason: "The file was declared as plain text but contains binary data.",
        };
  }

  const expected = SIGNATURES[declaredMimeType];

  if (!expected) {
    // Unknown types never reach here — the allow-list rejects them first.
    return { valid: false, reason: `Unsupported file type "${declaredMimeType}".` };
  }

  if (expected.some((signature) => matchesSignature(buffer, signature))) {
    return { valid: true, detected: declaredMimeType };
  }

  /**
   * Naming the type we DID find is genuinely useful: the common cause is an
   * honest mistake, like a renamed file. It leaks nothing an attacker does not
   * already know about their own upload.
   */
  const detected = detectMimeType(buffer);

  return {
    valid: false,
    detected,
    reason: detected
      ? `File content is ${detected}, but it was declared as ${declaredMimeType}.`
      : `File content does not match the declared type ${declaredMimeType}.`,
  };
};

/**
 * Best-effort identification from content alone.
 *
 * @param {Buffer} buffer
 * @returns {string|null}
 */
const detectMimeType = (buffer) => {
  for (const [mimeType, signatures] of Object.entries(SIGNATURES)) {
    if (signatures.some((signature) => matchesSignature(buffer, signature))) {
      return mimeType;
    }
  }

  /**
   * Recognised only to produce a clear message. These are never accepted —
   * the allow-list has already rejected them by declared type, and this branch
   * exists so a spoofed executable is named explicitly in the error.
   */
  const dangerous = [
    { mimeType: "application/x-msdownload (Windows executable)", offset: 0, bytes: [0x4d, 0x5a] },
    { mimeType: "application/x-elf (Linux executable)", offset: 0, bytes: [0x7f, 0x45, 0x4c, 0x46] },
    { mimeType: "application/zip", offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04] },
    { mimeType: "application/gzip", offset: 0, bytes: [0x1f, 0x8b] },
    { mimeType: "application/x-rar", offset: 0, bytes: [0x52, 0x61, 0x72, 0x21] },
    { mimeType: "application/x-7z", offset: 0, bytes: [0x37, 0x7a, 0xbc, 0xaf] },
    { mimeType: "application/x-mach-binary", offset: 0, bytes: [0xcf, 0xfa, 0xed, 0xfe] },
  ];

  for (const candidate of dangerous) {
    if (matchesSignature(buffer, candidate)) {
      return candidate.mimeType;
    }
  }

  return null;
};

module.exports = { detectMimeType, verifyFileSignature };
