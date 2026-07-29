const { body, param, query } = require("express-validator");

const mongoIdParam = (name, label) =>
  param(name).isMongoId().withMessage(`${label} must be a valid MongoDB id.`);

exports.grantAccessRules = [
  mongoIdParam("recordId", "Record id"),
  body("doctorId").isMongoId().withMessage("doctorId must be a valid MongoDB id."),
  body("expiresAt")
    .optional({ checkFalsy: true })
    .isISO8601()
    .withMessage("expiresAt must be a valid ISO 8601 date.")
    .custom((value) => {
      if (new Date(value) <= new Date()) {
        throw new Error("expiresAt must be in the future.");
      }
      return true;
    }),
  body("note")
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 300 })
    .withMessage("Note cannot exceed 300 characters."),
];

exports.revokeAccessRules = [
  mongoIdParam("recordId", "Record id"),
  mongoIdParam("doctorId", "Doctor id"),
];

exports.recordIdRules = [mongoIdParam("recordId", "Record id")];

exports.grantListRules = [
  query("page").optional().isInt({ min: 1 }).withMessage("Page must be a positive integer."),
  query("limit")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("Limit must be between 1 and 100."),
];
