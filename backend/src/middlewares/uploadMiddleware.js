const mongoSanitize = require("express-mongo-sanitize");
const multer = require("multer");

const { env } = require("../config/env");
const { ALLOWED_MIME_TYPES } = require("../constants/records");
const AppError = require("../utils/AppError");

/**
 * Multipart upload middleware.
 *
 * Memory storage is deliberate: the plaintext file must be encrypted before it
 * touches any disk, so buffering it in memory and handing it straight to the
 * encryption service avoids ever writing an unencrypted medical document to
 * the filesystem. The size limit below is what keeps that safe.
 */
const storage = multer.memoryStorage();

const fileFilter = (_req, file, callback) => {
  if (!ALLOWED_MIME_TYPES[file.mimetype]) {
    return callback(
      new AppError(
        `Unsupported file type "${file.mimetype}". Allowed types: ${Object.keys(ALLOWED_MIME_TYPES).join(", ")}.`,
        415
      )
    );
  }

  return callback(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: env.MAX_UPLOAD_SIZE_MB * 1024 * 1024,
    files: 1,
    fields: 20,
  },
});

/**
 * The global express-mongo-sanitize middleware in app.js runs before Multer,
 * at which point a multipart request still has an empty req.body. The text
 * fields that Multer later populates would therefore never be sanitized, so
 * the same sanitizer is re-applied here once the body actually exists.
 */
const sanitizeMultipartBody = (req, _res, next) => {
  if (req.body) {
    req.body = mongoSanitize.sanitize(req.body, { replaceWith: "_" });
  }

  next();
};

/** Accepts exactly one file under the `file` form field, then sanitizes the text fields. */
const uploadSingleRecord = [upload.single("file"), sanitizeMultipartBody];

module.exports = { uploadSingleRecord };
