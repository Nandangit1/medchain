const express = require("express");

const accessController = require("../controllers/accessController");
const patientController = require("../controllers/patientController");
const { ROLES } = require("../constants/roles");
const { authorize, protect } = require("../middlewares/authMiddleware");
const validateRequest = require("../middlewares/validateRequest");
const { grantListRules } = require("../validators/accessValidators");

const router = express.Router();

router.use(protect);
router.use(authorize(ROLES.PATIENT));

router.get("/me/dashboard", patientController.getDashboard);

/** Every doctor the patient has ever granted access to, live or revoked. */
router.get("/me/grants", grantListRules, validateRequest, accessController.listMyGrants);

/** Wallet + on-chain identity, and the doctors currently able to read anything. */
router.get("/me/wallet", patientController.getWallet);

module.exports = router;
