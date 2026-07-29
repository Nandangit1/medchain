const express = require("express");

const authController = require("../controllers/authController");
const { protect } = require("../middlewares/authMiddleware");
const validateRequest = require("../middlewares/validateRequest");
const {
  changePasswordRules,
  loginRules,
  registerRules,
  updateMeRules,
} = require("../validators/authValidators");

const router = express.Router();

router.post("/register", registerRules, validateRequest, authController.register);
router.post("/login", loginRules, validateRequest, authController.login);
router.post("/logout", authController.logout);

router.use(protect);

router.get("/me", authController.getMe);
router.patch("/me", updateMeRules, validateRequest, authController.updateMe);
router.patch(
  "/change-password",
  changePasswordRules,
  validateRequest,
  authController.changePassword
);

module.exports = router;
