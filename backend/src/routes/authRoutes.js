const express = require("express");
const rateLimit = require("express-rate-limit");

const authController = require("../controllers/authController");
const { protect } = require("../middlewares/authMiddleware");
const validateRequest = require("../middlewares/validateRequest");
const {
  changeEmailRules,
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

/**
 * Separate counters for the reset flow and for account changes, so a burst of
 * failed sign-ins cannot lock someone out of recovering their password, and
 * vice versa. Each instance keeps its own store.
 *
 * The reset ceiling is higher than sign-in because the real brute-force guard
 * is per code: tokenService burns a code after five wrong guesses, and a new
 * one can be requested at most once a minute. This limit only stops one IP
 * from cycling through many accounts.
 */
const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    status: "fail",
    message: "Too many attempts. Please wait a few minutes and try again.",
  },
});

const accountChangeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
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
  resetLimiter,
  forgotPasswordRules,
  validateRequest,
  authController.forgotPassword
);
router.post(
  "/reset-password",
  resetLimiter,
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
  "/email",
  accountChangeLimiter,
  changeEmailRules,
  validateRequest,
  authController.changeEmail
);
router.patch(
  "/change-password",
  changePasswordRules,
  validateRequest,
  authController.changePassword
);

module.exports = router;
