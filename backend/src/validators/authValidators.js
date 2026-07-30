const { body } = require("express-validator");
const { ROLES } = require("../constants/roles");

const passwordRule = (field) =>
  body(field)
    .isString()
    .withMessage("Password must be a string.")
    .isLength({ min: 8, max: 72 })
    .withMessage("Password must contain 8 to 72 characters.")
    .matches(/[a-z]/)
    .withMessage("Password must include a lowercase letter.")
    .matches(/[A-Z]/)
    .withMessage("Password must include an uppercase letter.")
    .matches(/[0-9]/)
    .withMessage("Password must include a number.")
    .matches(/[^A-Za-z0-9]/)
    .withMessage("Password must include a special character.");

exports.registerRules = [
  body("name")
    .trim()
    .isLength({ min: 2, max: 80 })
    .withMessage("Name must contain 2 to 80 characters."),
  body("email").trim().isEmail().withMessage("Please provide a valid email address.").normalizeEmail(),
  passwordRule("password"),
  body("role")
    .isIn([ROLES.PATIENT, ROLES.DOCTOR])
    .withMessage("Role must be patient or doctor. Admin accounts are created by seed script."),
  body("phone")
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 20 })
    .withMessage("Phone number cannot exceed 20 characters."),
  body("gender")
    .optional({ checkFalsy: true })
    .isIn(["male", "female", "other", "prefer_not_to_say"])
    .withMessage("Invalid gender value."),
  body("dateOfBirth").optional({ checkFalsy: true }).isISO8601().withMessage("Invalid date of birth."),
  body("address").optional().isObject().withMessage("Address must be an object."),
  body("patientProfile").optional().isObject().withMessage("Patient profile must be an object."),
  body("doctorProfile").if(body("role").equals(ROLES.DOCTOR)).isObject().withMessage("Doctor profile is required."),
  body("doctorProfile.specialization")
    .if(body("role").equals(ROLES.DOCTOR))
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage("Doctor specialization must contain 2 to 100 characters."),
  body("doctorProfile.medicalLicenseNumber")
    .if(body("role").equals(ROLES.DOCTOR))
    .trim()
    .isLength({ min: 3, max: 60 })
    .withMessage("Medical license number must contain 3 to 60 characters."),
  body("doctorProfile.experienceYears")
    .optional({ checkFalsy: true })
    .isInt({ min: 0, max: 70 })
    .withMessage("Experience must be between 0 and 70 years."),
];

exports.loginRules = [
  body("email").trim().isEmail().withMessage("Please provide a valid email address.").normalizeEmail(),
  body("password").notEmpty().withMessage("Password is required."),
];

exports.updateMeRules = [
  body("email").not().exists().withMessage("Email cannot be changed from this route."),
  body("password").not().exists().withMessage("Password cannot be changed from this route."),
  body("role").not().exists().withMessage("Role cannot be changed."),
  body("name")
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ min: 2, max: 80 })
    .withMessage("Name must contain 2 to 80 characters."),
  body("phone")
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 20 })
    .withMessage("Phone number cannot exceed 20 characters."),
  body("gender")
    .optional({ checkFalsy: true })
    .isIn(["male", "female", "other", "prefer_not_to_say"])
    .withMessage("Invalid gender value."),
  body("dateOfBirth").optional({ checkFalsy: true }).isISO8601().withMessage("Invalid date of birth."),
  body("address").optional().isObject().withMessage("Address must be an object."),
  body("patientProfile").optional().isObject().withMessage("Patient profile must be an object."),
  body("doctorProfile").optional().isObject().withMessage("Doctor profile must be an object."),
];

exports.forgotPasswordRules = [
  body("email").trim().isEmail().withMessage("Please provide a valid email address.").normalizeEmail(),
];

exports.resetPasswordRules = [
  body("token")
    .isString()
    .isLength({ min: 32, max: 128 })
    .withMessage("A valid reset token is required."),
  passwordRule("newPassword"),
  body("newPasswordConfirm")
    .custom((value, { req }) => value === req.body.newPassword)
    .withMessage("Password confirmation does not match."),
];

exports.changePasswordRules = [
  body("currentPassword").notEmpty().withMessage("Current password is required."),
  passwordRule("newPassword"),
  body("newPasswordConfirm")
    .custom((value, { req }) => value === req.body.newPassword)
    .withMessage("Password confirmation does not match."),
];
