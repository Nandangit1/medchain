const { body, param } = require("express-validator");

const { ABHA_NUMBER_PATTERN } = require("../constants/abdm");

const abhaNumberRule = body("abhaNumber")
  .isString()
  .trim()
  .matches(ABHA_NUMBER_PATTERN)
  .withMessage("An ABHA number is 14 digits, for example 12-3456-7890-1234.");

exports.abhaOtpRules = [abhaNumberRule];

exports.linkAbhaRules = [
  abhaNumberRule,
  body("otp")
    .isString()
    .trim()
    .isLength({ min: 6, max: 6 })
    .withMessage("Enter the 6-digit OTP."),
  body("abhaAddress")
    .optional({ values: "falsy" })
    .isString()
    .trim()
    .isLength({ max: 60 })
    .withMessage("An ABHA address looks like yourname@abdm."),
];

exports.eraseRules = [
  body("password").notEmpty().withMessage("Your password is required to erase your data."),
  body("confirm")
    .equals("ERASE")
    .withMessage('Type ERASE to confirm. This cannot be undone.'),
];

exports.recordIdRule = [param("recordId").isMongoId().withMessage("Invalid record id.")];
