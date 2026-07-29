const express = require("express");

const doctorController = require("../controllers/doctorController");
const { protect, requireVerifiedDoctor } = require("../middlewares/authMiddleware");
const { uploadSingleRecord } = require("../middlewares/uploadMiddleware");
const validateRequest = require("../middlewares/validateRequest");
const {
  diagnosisRules,
  listRules,
  prescriptionRules,
  recordIdRules,
} = require("../validators/doctorValidators");

const router = express.Router();

/**
 * Every route here demands a doctor whose credentials an administrator has
 * verified. `requireVerifiedDoctor` also rejects patients and admins, so no
 * separate authorize() call is needed.
 */
router.use(protect);
router.use(requireVerifiedDoctor);

router.get("/me/dashboard", doctorController.getDashboard);

router.get("/me/patients", doctorController.getPatients);

router.get("/me/records", listRules, validateRequest, doctorController.getSharedRecords);

router.get("/me/diagnoses", listRules, validateRequest, doctorController.getMyDiagnoses);

router.post(
  "/records/:recordId/diagnoses",
  diagnosisRules,
  validateRequest,
  doctorController.createDiagnosis
);

router.get(
  "/records/:recordId/diagnoses",
  recordIdRules,
  validateRequest,
  doctorController.getRecordDiagnoses
);

/** Reuses the Module 3 encrypt -> pin -> anchor pipeline. */
router.post(
  "/patients/:patientId/prescriptions",
  uploadSingleRecord,
  prescriptionRules,
  validateRequest,
  doctorController.uploadPrescription
);

module.exports = router;
