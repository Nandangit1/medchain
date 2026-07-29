const express = require("express");

const accessController = require("../controllers/accessController");
const medicalRecordController = require("../controllers/medicalRecordController");
const { ROLES } = require("../constants/roles");
const { authorize, protect } = require("../middlewares/authMiddleware");
const { uploadSingleRecord } = require("../middlewares/uploadMiddleware");
const validateRequest = require("../middlewares/validateRequest");
const {
  grantAccessRules,
  recordIdRules: accessRecordIdRules,
  revokeAccessRules,
} = require("../validators/accessValidators");
const {
  listRecordRules,
  recordIdRules,
  updateRecordRules,
  uploadRecordRules,
} = require("../validators/medicalRecordValidators");

const router = express.Router();

// Every medical-record route requires an authenticated, active account.
router.use(protect);

/**
 * Upload accepts multipart/form-data. The Multer middleware must run before
 * the validators, because the text fields do not exist on req.body until the
 * multipart body has been parsed.
 */
router.post(
  "/",
  authorize(ROLES.PATIENT),
  uploadSingleRecord,
  uploadRecordRules,
  validateRequest,
  medicalRecordController.uploadRecord
);

/**
 * Doctors are included here: the service scopes their results to exactly the
 * records currently shared with them.
 */
router.get(
  "/",
  authorize(ROLES.PATIENT, ROLES.DOCTOR, ROLES.ADMIN),
  listRecordRules,
  validateRequest,
  medicalRecordController.getRecords
);

router.get(
  "/:recordId",
  authorize(ROLES.PATIENT, ROLES.DOCTOR, ROLES.ADMIN),
  recordIdRules,
  validateRequest,
  medicalRecordController.getRecordById
);

/**
 * Plaintext retrieval. Admins are rejected inside the service; doctors must
 * hold a live access grant, verified against MongoDB and the chain.
 */
router.get(
  "/:recordId/download",
  authorize(ROLES.PATIENT, ROLES.DOCTOR),
  recordIdRules,
  validateRequest,
  medicalRecordController.downloadRecord
);

router.get(
  "/:recordId/verify",
  authorize(ROLES.PATIENT, ROLES.DOCTOR, ROLES.ADMIN),
  recordIdRules,
  validateRequest,
  medicalRecordController.verifyRecordIntegrity
);

/** Provenance straight from the contract's event log. */
router.get(
  "/:recordId/history",
  authorize(ROLES.PATIENT, ROLES.ADMIN),
  accessRecordIdRules,
  validateRequest,
  accessController.getRecordHistory
);

// --- Sharing (Module 5) ----------------------------------------------------

router.get(
  "/:recordId/access",
  authorize(ROLES.PATIENT),
  accessRecordIdRules,
  validateRequest,
  accessController.listRecordAccess
);

router.post(
  "/:recordId/share",
  authorize(ROLES.PATIENT),
  grantAccessRules,
  validateRequest,
  accessController.grantAccess
);

router.delete(
  "/:recordId/share/:doctorId",
  authorize(ROLES.PATIENT),
  revokeAccessRules,
  validateRequest,
  accessController.revokeAccess
);

// --- Metadata management ---------------------------------------------------

router.patch(
  "/:recordId",
  authorize(ROLES.PATIENT),
  updateRecordRules,
  validateRequest,
  medicalRecordController.updateRecord
);

router.delete(
  "/:recordId",
  authorize(ROLES.PATIENT),
  recordIdRules,
  validateRequest,
  medicalRecordController.deleteRecord
);

module.exports = router;
