const express = require("express");

const adminController = require("../controllers/adminController");
const { ROLES } = require("../constants/roles");
const { authorize, protect } = require("../middlewares/authMiddleware");
const validateRequest = require("../middlewares/validateRequest");
const {
  doctorListRules,
  doctorStatusRules,
  rejectDoctorRules,
  userIdRules,
  userListRules,
  userStatusRules,
} = require("../validators/adminValidators");

const router = express.Router();

router.use(protect);
router.use(authorize(ROLES.ADMIN));

router.get("/users", userListRules, validateRequest, adminController.getUsers);
router.get("/users/:userId", userIdRules, validateRequest, adminController.getUserById);
router.patch(
  "/users/:userId/status",
  userStatusRules,
  validateRequest,
  adminController.updateUserStatus
);

router.get("/doctors", doctorListRules, validateRequest, adminController.getDoctors);
router.patch(
  "/doctors/:doctorId/verify",
  doctorStatusRules,
  validateRequest,
  adminController.verifyDoctor
);
router.patch(
  "/doctors/:doctorId/reject",
  rejectDoctorRules,
  validateRequest,
  adminController.rejectDoctor
);

module.exports = router;
