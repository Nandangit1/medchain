const { body, param, query } = require("express-validator");
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
