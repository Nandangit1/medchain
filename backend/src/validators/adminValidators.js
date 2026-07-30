const { body, param, query } = require("express-validator");
const { AUDIT_ACTIONS, AUDIT_CATEGORIES, AUDIT_OUTCOMES } = require("../constants/audit");
const { BLOCKCHAIN_SYNC_STATUS, CHAIN_TX_TYPES } = require("../constants/records");
const { DOCTOR_VERIFICATION_STATUS, ROLES } = require("../constants/roles");

const mongoIdParam = (name, label) => param(name).isMongoId().withMessage(`${label} must be a valid MongoDB id.`);

const paginationRules = [
  query("page").optional().isInt({ min: 1 }).withMessage("Page must be a positive integer."),
  query("limit").optional().isInt({ min: 1, max: 100 }).withMessage("Limit must be between 1 and 100."),
  query("search")
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ min: 2, max: 80 })
    .withMessage("Search must contain 2 to 80 characters."),
  query("isActive").optional().isBoolean().withMessage("isActive must be true or false."),
];

exports.userListRules = [
  ...paginationRules,
  query("role").optional().isIn(Object.values(ROLES)).withMessage("Invalid role filter."),
];

exports.doctorListRules = [
  ...paginationRules,
  query("verificationStatus")
    .optional()
    .isIn(Object.values(DOCTOR_VERIFICATION_STATUS))
    .withMessage("Invalid doctor verification status."),
];

exports.auditListRules = [
  query("page").optional().isInt({ min: 1 }).withMessage("Page must be a positive integer."),
  query("limit").optional().isInt({ min: 1, max: 100 }).withMessage("Limit must be 1 to 100."),
  query("category").optional().isIn(Object.values(AUDIT_CATEGORIES)).withMessage("Invalid category."),
  query("action").optional().isIn(Object.values(AUDIT_ACTIONS)).withMessage("Invalid action."),
  query("outcome").optional().isIn(Object.values(AUDIT_OUTCOMES)).withMessage("Invalid outcome."),
  query("actor").optional().isMongoId().withMessage("actor must be a valid MongoDB id."),
  query("from").optional().isISO8601().withMessage("from must be a valid ISO 8601 date."),
  query("to").optional().isISO8601().withMessage("to must be a valid ISO 8601 date."),
  query("search").optional({ checkFalsy: true }).trim().isLength({ min: 2, max: 80 }),
];

exports.transactionListRules = [
  query("page").optional().isInt({ min: 1 }).withMessage("Page must be a positive integer."),
  query("limit").optional().isInt({ min: 1, max: 100 }).withMessage("Limit must be 1 to 100."),
  query("type").optional().isIn(Object.values(CHAIN_TX_TYPES)).withMessage("Invalid transaction type."),
  query("status")
    .optional()
    .isIn(Object.values(BLOCKCHAIN_SYNC_STATUS))
    .withMessage("Invalid transaction status."),
  query("search").optional({ checkFalsy: true }).trim().isLength({ min: 2, max: 80 }),
];

exports.userIdRules = [mongoIdParam("userId", "User id")];

exports.userStatusRules = [
  mongoIdParam("userId", "User id"),
  body("isActive").isBoolean().withMessage("isActive must be true or false.").toBoolean(),
];

exports.doctorStatusRules = [mongoIdParam("doctorId", "Doctor id")];

exports.rejectDoctorRules = [
  mongoIdParam("doctorId", "Doctor id"),
  body("rejectionReason")
    .trim()
    .isLength({ min: 5, max: 300 })
    .withMessage("Rejection reason must contain 5 to 300 characters."),
];
