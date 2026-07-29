const { body, param, query } = require("express-validator");

const {
  BLOCKCHAIN_SYNC_STATUS,
  RECORD_STATUS,
  RECORD_TYPES,
} = require("../constants/records");

/**
 * Each rule is exposed as a FACTORY rather than a shared constant.
 *
 * express-validator chains are mutable: calling `.optional()` on a shared
 * chain mutates that instance and every rule array holding a reference to it.
 * Sharing one `titleRule` between the create and update rule sets would make
 * `title` optional on upload as a side effect of making it optional on
 * update. Building a fresh chain per rule set removes that hazard entirely.
 */
const mongoIdParam = (name, label) =>
  param(name).isMongoId().withMessage(`${label} must be a valid MongoDB id.`);

const titleRule = ({ optional = false } = {}) => {
  const chain = body("title");

  if (optional) {
    chain.optional();
  }

  return chain
    .trim()
    .isLength({ min: 3, max: 140 })
    .withMessage("Title must contain 3 to 140 characters.");
};

const descriptionRule = () =>
  body("description")
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 1000 })
    .withMessage("Description cannot exceed 1000 characters.");

const recordTypeRule = ({ optional = false } = {}) => {
  const chain = body("recordType");

  if (optional) {
    chain.optional();
  }

  return chain
    .isIn(Object.values(RECORD_TYPES))
    .withMessage(`Record type must be one of: ${Object.values(RECORD_TYPES).join(", ")}.`);
};

const recordDateRule = () =>
  body("recordDate")
    .optional({ checkFalsy: true })
    .isISO8601()
    .withMessage("Record date must be a valid ISO 8601 date.")
    .custom((value) => {
      if (new Date(value) > new Date()) {
        throw new Error("Record date cannot be in the future.");
      }
      return true;
    });

/**
 * Tags arrive either as a repeated field or as a comma-separated string,
 * because the upload endpoint is multipart/form-data where every value is a
 * string. Normalisation into a clean array happens in the service layer.
 */
const tagsRule = () =>
  body("tags")
    .optional({ checkFalsy: true })
    .custom((value) => {
      const list = Array.isArray(value) ? value : String(value).split(",");

      if (list.length > 10) {
        throw new Error("A record cannot carry more than 10 tags.");
      }

      if (list.some((tag) => String(tag).trim().length > 30)) {
        throw new Error("Each tag must be 30 characters or fewer.");
      }

      return true;
    });

const statusRule = () =>
  body("status")
    .optional()
    .isIn(Object.values(RECORD_STATUS))
    .withMessage(`Status must be one of: ${Object.values(RECORD_STATUS).join(", ")}.`);

exports.uploadRecordRules = [
  titleRule(),
  descriptionRule(),
  recordTypeRule(),
  recordDateRule(),
  tagsRule(),
];

exports.updateRecordRules = [
  mongoIdParam("recordId", "Record id"),
  titleRule({ optional: true }),
  descriptionRule(),
  recordTypeRule({ optional: true }),
  recordDateRule(),
  tagsRule(),
  statusRule(),
];

exports.listRecordRules = [
  query("page").optional().isInt({ min: 1 }).withMessage("Page must be a positive integer."),
  query("limit")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("Limit must be between 1 and 100."),
  query("search")
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ min: 2, max: 80 })
    .withMessage("Search must contain 2 to 80 characters."),
  query("patientId").optional().isMongoId().withMessage("patientId must be a valid MongoDB id."),
  query("recordType")
    .optional()
    .isIn(Object.values(RECORD_TYPES))
    .withMessage("Invalid record type filter."),
  query("status")
    .optional()
    .isIn(Object.values(RECORD_STATUS))
    .withMessage("Invalid record status filter."),
  query("blockchainStatus")
    .optional()
    .isIn(Object.values(BLOCKCHAIN_SYNC_STATUS))
    .withMessage("Invalid blockchain status filter."),
  query("from").optional().isISO8601().withMessage("from must be a valid ISO 8601 date."),
  query("to").optional().isISO8601().withMessage("to must be a valid ISO 8601 date."),
];

exports.recordIdRules = [mongoIdParam("recordId", "Record id")];
