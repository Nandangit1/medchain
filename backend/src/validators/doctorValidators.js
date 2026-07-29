const { body, param, query } = require("express-validator");

const mongoIdParam = (name, label) =>
  param(name).isMongoId().withMessage(`${label} must be a valid MongoDB id.`);

const paginationRules = [
  query("page").optional().isInt({ min: 1 }).withMessage("Page must be a positive integer."),
  query("limit")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("Limit must be between 1 and 100."),
];

exports.diagnosisRules = [
  mongoIdParam("recordId", "Record id"),
  body("summary")
    .trim()
    .isLength({ min: 5, max: 300 })
    .withMessage("Summary must contain 5 to 300 characters."),
  body("details")
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 4000 })
    .withMessage("Details cannot exceed 4000 characters."),
  body("icdCode")
    .optional({ checkFalsy: true })
    .trim()
    .matches(/^[A-Za-z][0-9]{2}(\.[0-9A-Za-z]{1,4})?$/)
    .withMessage("ICD code must look like A00 or E11.9."),
  body("severity")
    .optional()
    .isIn(["low", "moderate", "high", "critical"])
    .withMessage("Severity must be low, moderate, high or critical."),
  body("followUpAt")
    .optional({ checkFalsy: true })
    .isISO8601()
    .withMessage("followUpAt must be a valid ISO 8601 date."),
];

exports.prescriptionRules = [
  mongoIdParam("patientId", "Patient id"),
  body("title")
    .trim()
    .isLength({ min: 3, max: 140 })
    .withMessage("Title must contain 3 to 140 characters."),
  body("description")
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 1000 })
    .withMessage("Description cannot exceed 1000 characters."),
  body("diagnosisId")
    .optional({ checkFalsy: true })
    .isMongoId()
    .withMessage("diagnosisId must be a valid MongoDB id."),
];

exports.recordIdRules = [mongoIdParam("recordId", "Record id")];
exports.listRules = paginationRules;
