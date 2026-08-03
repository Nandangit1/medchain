const { env } = require("../config/env");
const logger = require("../config/logger");

const handleDuplicateFields = (error) => {
  const fields = Object.keys(error.keyValue || {}).join(", ");
  return {
    statusCode: 409,
    message: `${fields || "Field"} already exists.`,
  };
};

const handleValidationError = (error) => ({
  statusCode: 400,
  message: Object.values(error.errors)
    .map((item) => item.message)
    .join(" "),
});

const handleJwtError = () => ({
  statusCode: 401,
  message: "Invalid token. Please log in again.",
});

const handleJwtExpiredError = () => ({
  statusCode: 401,
  message: "Your session has expired. Please log in again.",
});

/**
 * Multer rejects oversized or unexpected uploads with its own error class.
 * Without this branch those surface as a generic 500 instead of telling the
 * client what it actually did wrong.
 */
const handleMulterError = (error) => {
  const messages = {
    LIMIT_FILE_SIZE: "The uploaded file exceeds the maximum permitted size.",
    LIMIT_FILE_COUNT: "Only one file may be uploaded per request.",
    LIMIT_UNEXPECTED_FILE: 'Unexpected file field. Send the document in the "file" field.',
  };

  return {
    statusCode: error.code === "LIMIT_FILE_SIZE" ? 413 : 400,
    message: messages[error.code] || `File upload failed: ${error.message}`,
  };
};

const normalizeError = (error) => {
  if (error.name === "MulterError") {
    return handleMulterError(error);
  }

  if (error.code === 11000) {
    return handleDuplicateFields(error);
  }

  if (error.name === "ValidationError") {
    return handleValidationError(error);
  }

  if (error.name === "JsonWebTokenError") {
    return handleJwtError();
  }

  if (error.name === "TokenExpiredError") {
    return handleJwtExpiredError();
  }

  return {
    statusCode: error.statusCode || 500,
    message: error.message || "Something went wrong.",
  };
};

module.exports = (error, req, res, _next) => {
  const normalizedError = normalizeError(error);
  const statusCode = normalizedError.statusCode;
  const status = String(statusCode).startsWith("4") ? "fail" : "error";

  if (env.NODE_ENV !== "production") {
    console.error(error);
  }

  /**
   * 500s are logged with their stack. In production the client is told only
   * "Something went wrong", so without this the single copy of what actually
   * broke exists nowhere -- the server is silent about its own bugs. 4xx are
   * left out: they are the client's mistake, already described in the response,
   * and logging them lets anyone fill the disk with bad requests.
   */
  if (statusCode >= 500) {
    logger.error("Unhandled request error", {
      method: req.method,
      path: req.originalUrl,
      userId: req.user?._id ? String(req.user._id) : undefined,
      name: error.name,
      reason: error.message,
      stack: error.stack,
    });
  }

  res.status(statusCode).json({
    status,
    message:
      statusCode === 500 && env.NODE_ENV === "production"
        ? "Something went wrong."
        : normalizedError.message,
    ...(env.NODE_ENV !== "production" && { stack: error.stack }),
  });
};
