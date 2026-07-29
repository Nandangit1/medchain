const express = require("express");

const medicalRecordController = require("../controllers/medicalRecordController");
const { ROLES } = require("../constants/roles");
const { authorize, protect } = require("../middlewares/authMiddleware");
const { uploadSingleRecord } = require("../middlewares/uploadMiddleware");
const validateRequest = require("../middlewares/validateRequest");
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

router.get(
  "/",
  authorize(ROLES.PATIENT, ROLES.ADMIN),
  listRecordRules,
  validateRequest,
  medicalRecordController.getRecords
);

router.get(
  "/:recordId",
  authorize(ROLES.PATIENT, ROLES.ADMIN),
  recordIdRules,
  validateRequest,
  medicalRecordController.getRecordById
);

// Plaintext retrieval — owner only. Admins are rejected inside the service.
router.get(
  "/:recordId/download",
  authorize(ROLES.PATIENT),
  recordIdRules,
  validateRequest,
  medicalRecordController.downloadRecord
);

router.get(
  "/:recordId/verify",
  authorize(ROLES.PATIENT, ROLES.ADMIN),
  recordIdRules,
  validateRequest,
  medicalRecordController.verifyRecordIntegrity
);

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
