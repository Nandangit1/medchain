const { body, param, query } = require("express-validator");

const { VITAL_TYPES } = require("../models/VitalSign");

const appointmentIdRule = param("appointmentId").isMongoId().withMessage("Invalid appointment id.");

exports.draftNoteRules = [
  appointmentIdRule,
  body("transcript")
    .isString()
    .trim()
    .isLength({ min: 20, max: 60000 })
    .withMessage("Provide the consultation transcript."),
];

exports.signNoteRules = [
  appointmentIdRule,
  body("summary")
    .isString()
    .trim()
    .isLength({ min: 3, max: 500 })
    .withMessage("A summary is required."),
  body("details").optional({ values: "falsy" }).isString().trim().isLength({ max: 4000 }),
  body("icdCode").optional({ values: "falsy" }).isString().trim().isLength({ max: 20 }),
  body("severity")
    .optional({ values: "falsy" })
    .isIn(["low", "moderate", "high", "critical", "unspecified"])
    .withMessage("Unknown severity."),
  body("followUpAt").optional({ values: "falsy" }).isISO8601().toDate(),
  body("transcriptHash")
    .optional({ values: "falsy" })
    .isHexadecimal()
    .isLength({ min: 64, max: 64 })
    .withMessage("The transcript hash must be 64 hexadecimal characters."),
];

exports.recordVitalRules = [
  body("type").isIn(Object.values(VITAL_TYPES)).withMessage("Unknown vital type."),
  body("value").isFloat().withMessage("A numeric value is required."),
  body("secondaryValue").optional({ values: "falsy" }).isFloat(),
  body("unit").isString().trim().isLength({ min: 1, max: 20 }).withMessage("A unit is required."),
  body("source").optional({ values: "falsy" }).isString().trim().isLength({ max: 60 }),
  body("measuredAt").optional({ values: "falsy" }).isISO8601().toDate(),
];

exports.listVitalsRules = [
  query("type").optional().isIn(Object.values(VITAL_TYPES)).withMessage("Unknown vital type."),
  query("since").optional().isISO8601(),
  query("limit").optional().isInt({ min: 1, max: 1000 }),
];
