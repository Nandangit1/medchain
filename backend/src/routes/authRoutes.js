const express = require("express");
const rateLimit = require("express-rate-limit");

const authController = require("../controllers/authController");
const { protect } = require("../middlewares/authMiddleware");
const validateRequest = require("../middlewares/validateRequest");
const {
  changePasswordRules,
  disableMfaRules,
  forgotPasswordRules,
  loginRules,
  mfaCodeRules,
  registerRules,
  resetPasswordRules,
  updateMeRules,
  verifyMfaRules,
} = require("../validators/authValidators");

const router = express.Router();

/**
 * Credential endpoints get a much tighter limit than the global one.
 * 200 requests per 15 minutes is generous for browsing; it is an invitation
 * for password guessing.
 */
const credentialLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  // Successful sign-ins should not count towards the lockout.
  skipSuccessfulRequests: true,
  message: {
    status: "fail",
    message: "Too many attempts. Please wait a few minutes and try again.",
  },
});

router.post("/register", registerRules, validateRequest, authController.register);
router.post("/login", credentialLimiter, loginRules, validateRequest, authController.login);
router.post("/refresh", authController.refresh);
router.post("/logout", authController.logout);

router.post(
  "/forgot-password",
  credentialLimiter,
  forgotPasswordRules,
  validateRequest,
  authController.forgotPassword
);
router.post(
  "/reset-password",
  credentialLimiter,
  resetPasswordRules,
  validateRequest,
  authController.resetPassword
);

/**
 * Second leg of sign-in. Rate limited like the first: without it, a stolen
 * password plus an unlimited code endpoint is a 6-digit brute force.
 */
router.post(
  "/mfa/verify",
  credentialLimiter,
  verifyMfaRules,
  validateRequest,
  authController.verifyMfa
);

router.use(protect);

router.get("/mfa", authController.mfaStatus);
router.post("/mfa/setup", authController.startMfaEnrolment);
router.post("/mfa/enable", mfaCodeRules, validateRequest, authController.confirmMfaEnrolment);
router.post(
  "/mfa/disable",
  credentialLimiter,
  disableMfaRules,
  validateRequest,
  authController.disableMfa
);

router.get("/me", authController.getMe);
router.patch("/me", updateMeRules, validateRequest, authController.updateMe);
router.patch(
  "/change-password",
  changePasswordRules,
  validateRequest,
  authController.changePassword
);

module.exports = router;
