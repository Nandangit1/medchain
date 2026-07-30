const path = require("path");
const winston = require("winston");
require("winston-daily-rotate-file");

const { env } = require("./env");

/**
 * Structured application logger.
 *
 * Morgan already logs HTTP traffic; this handles everything else — auth
 * events, blockchain submissions, failures — as JSON so the files can be
 * grepped or shipped to a log aggregator without parsing prose.
 *
 * Files rotate daily and are capped, because an unbounded log on a student
 * VM eventually fills the disk and takes the API down with it.
 */
const LOG_DIR = path.resolve(process.cwd(), "logs");

/**
 * Redacts anything that must never reach a log file. Tokens and keys have a
 * habit of arriving inside `meta` objects that were logged for other reasons.
 */
const REDACTED_KEYS = [
  "password",
  "newPassword",
  "currentPassword",
  "token",
  "refreshToken",
  "authorization",
  "wrappedKey",
  "encryption",
  "privateKey",
  "FILE_ENCRYPTION_KEY",
  "CUSTODIAL_WALLET_SEED",
  "REGISTRAR_PRIVATE_KEY",
];

const redact = winston.format((info) => {
  const scrub = (value, depth = 0) => {
    if (depth > 4 || value === null || typeof value !== "object") {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((entry) => scrub(entry, depth + 1));
    }

    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        REDACTED_KEYS.includes(key) ? "[REDACTED]" : scrub(entry, depth + 1),
      ])
    );
  };

  return scrub(info);
});

const transports = [
  new winston.transports.DailyRotateFile({
    dirname: LOG_DIR,
    filename: "app-%DATE%.log",
    datePattern: "YYYY-MM-DD",
    maxSize: "10m",
    maxFiles: "14d",
    level: "info",
  }),
  new winston.transports.DailyRotateFile({
    dirname: LOG_DIR,
    filename: "error-%DATE%.log",
    datePattern: "YYYY-MM-DD",
    maxSize: "10m",
    maxFiles: "30d",
    level: "error",
  }),
];

// In development, readable console output beats JSON files.
if (env.NODE_ENV !== "production") {
  transports.push(
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(
          ({ level, message, timestamp, ...meta }) =>
            `${timestamp} ${level}: ${message}${
              Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : ""
            }`
        )
      ),
    })
  );
}

const logger = winston.createLogger({
  level: env.NODE_ENV === "production" ? "info" : "debug",
  format: winston.format.combine(
    redact(),
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: "blockchain-telemedicine-api" },
  transports,
  exitOnError: false,
});

module.exports = logger;
