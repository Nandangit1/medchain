const mongoSanitize = require("express-mongo-sanitize");
const multer = require("multer");

const { env } = require("../config/env");
const logger = require("../config/logger");
const { ALLOWED_MIME_TYPES } = require("../constants/records");
const AppError = require("../utils/AppError");
const { verifyFileSignature } = require("../utils/fileSignature");

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

/**
 * Verifies the file's real format against its declared type.
 *
 * This has to run AFTER Multer, not in `fileFilter`: the filter is called before
 * the stream is consumed, so there are no bytes to inspect yet. The declared
 * MIME type comes from the client and is spoofable, which is exactly what this
 * catches — an executable labelled application/pdf passes the allow-list but
 * fails here.
 */
const verifyFileContent = (req, _res, next) => {
  if (!req.file) {
    return next();
  }

  const { valid, reason, detected } = verifyFileSignature(req.file.buffer, req.file.mimetype);

  if (!valid) {
    logger.warn("Rejected an upload whose content did not match its declared type", {
      declared: req.file.mimetype,
      detected,
      originalName: req.file.originalname,
      size: req.file.size,
      userId: req.user ? String(req.user._id) : null,
      ip: req.ip,
    });

    return next(new AppError(reason, 415));
  }

  return next();
};

/**
 * One file under the `file` field, then sanitize the text fields, then confirm
 * the bytes really are the format they claim to be.
 */
const uploadSingleRecord = [upload.single("file"), sanitizeMultipartBody, verifyFileContent];

module.exports = { uploadSingleRecord, verifyFileContent };
