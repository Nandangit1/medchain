const express = require("express");

const proofController = require("../controllers/proofController");
const { ROLES } = require("../constants/roles");
const { authorize, protect } = require("../middlewares/authMiddleware");
const validateRequest = require("../middlewares/validateRequest");
const {
  attributeIdRules,
  createAttributeRules,
  createProofRules,
  verifyProofRules,
} = require("../validators/proofValidators");

const router = express.Router();

/**
 * Public: a proof only a MedChain account holder can check is not a proof.
 * This is the endpoint an insurer or employer calls.
 */
router.post("/verify", verifyProofRules, validateRequest, proofController.verifyProof);

router.use(protect);

// Only patients commit to their own measurements.
router.use(authorize(ROLES.PATIENT));

router.get("/attributes", proofController.listAttributes);
router.post("/attributes", createAttributeRules, validateRequest, proofController.createAttribute);
router.delete(
  "/attributes/:attributeId",
  attributeIdRules,
  validateRequest,
  proofController.deleteAttribute
);
router.post(
  "/attributes/:attributeId/prove",
  createProofRules,
  validateRequest,
  proofController.createProof
);

module.exports = router;
