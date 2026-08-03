const express = require("express");

const abdmController = require("../controllers/abdmController");
const { protect } = require("../middlewares/authMiddleware");
const validateRequest = require("../middlewares/validateRequest");
const { abhaOtpRules, eraseRules, linkAbhaRules } = require("../validators/abdmValidators");

const router = express.Router();

/**
 * The privacy notice is public on purpose: the DPDP Act requires it to be
 * available to a person deciding whether to sign up, which is necessarily
 * before they have an account.
 */
router.get("/privacy-notice", abdmController.getPrivacyNotice);

router.use(protect);

// --- ABHA ------------------------------------------------------------------
router.post("/abha/request-otp", abhaOtpRules, validateRequest, abdmController.requestAbhaOtp);
router.post("/abha/link", linkAbhaRules, validateRequest, abdmController.linkAbha);
router.delete("/abha", abdmController.unlinkAbha);

// --- FHIR R4 ---------------------------------------------------------------
router.get("/fhir/me", abdmController.getFhirSelf);
router.get("/fhir/DocumentReference/:recordId", abdmController.getFhirDocumentReference);

// --- DPDP data-principal rights --------------------------------------------
router.get("/me/export", abdmController.exportMyData);
router.delete("/me", eraseRules, validateRequest, abdmController.eraseMyData);

module.exports = router;
