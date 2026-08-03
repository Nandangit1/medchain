const express = require("express");

const scribeController = require("../controllers/scribeController");
const { ROLES } = require("../constants/roles");
const { authorize, protect } = require("../middlewares/authMiddleware");
const validateRequest = require("../middlewares/validateRequest");
const {
  draftNoteRules,
  listVitalsRules,
  recordVitalRules,
  signNoteRules,
} = require("../validators/scribeValidators");

const router = express.Router();

router.use(protect);

/**
 * Drafting and signing are both doctor-only, and the controller additionally
 * checks the caller is the treating doctor for that appointment -- holding the
 * doctor role is not permission to write into any patient's chart.
 */
router.post(
  "/consultations/:appointmentId/draft",
  authorize(ROLES.DOCTOR),
  draftNoteRules,
  validateRequest,
  scribeController.draftNote
);

router.post(
  "/consultations/:appointmentId/sign",
  authorize(ROLES.DOCTOR),
  signNoteRules,
  validateRequest,
  scribeController.signNote
);

// Vitals are the patient's own readings; only they record and read them.
router.get(
  "/vitals",
  authorize(ROLES.PATIENT),
  listVitalsRules,
  validateRequest,
  scribeController.listVitals
);
router.post(
  "/vitals",
  authorize(ROLES.PATIENT),
  recordVitalRules,
  validateRequest,
  scribeController.recordVital
);

module.exports = router;
