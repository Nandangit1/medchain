const { body, param } = require("express-validator");

const { PREDICATES } = require("../services/zkService");

exports.attributeIdRules = [param("attributeId").isMongoId().withMessage("Invalid claim id.")];

exports.createAttributeRules = [
  body("name")
    .isString()
    .trim()
    .isLength({ min: 2, max: 40 })
    .withMessage("Give the measurement a short name, for example hba1c."),
  body("value").isFloat({ min: 0 }).withMessage("The value must be a non-negative number."),
  body("unit").optional({ values: "falsy" }).isString().trim().isLength({ max: 20 }),
  body("label").optional({ values: "falsy" }).isString().trim().isLength({ max: 80 }),
  body("loincCode").optional({ values: "falsy" }).isString().trim().isLength({ max: 20 }),
  body("recordId").optional({ values: "falsy" }).isMongoId().withMessage("Invalid record id."),
  body("measuredAt").optional({ values: "falsy" }).isISO8601().toDate(),
];

exports.createProofRules = [
  ...exports.attributeIdRules,
  body("predicate")
    .isIn(Object.values(PREDICATES))
    .withMessage(`Predicate must be one of: ${Object.values(PREDICATES).join(", ")}.`),
  body("threshold").isFloat().withMessage("A numeric threshold is required."),
  body("audience").optional({ values: "falsy" }).isString().trim().isLength({ max: 120 }),
  body("expiresInHours")
    .optional()
    .isInt({ min: 1, max: 720 })
    .withMessage("Expiry must be between 1 and 720 hours."),
];

exports.verifyProofRules = [body("proof").isObject().withMessage("Send the proof object.")];
