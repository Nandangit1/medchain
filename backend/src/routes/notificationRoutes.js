const express = require("express");
const { param, query } = require("express-validator");

const notificationController = require("../controllers/notificationController");
const { protect } = require("../middlewares/authMiddleware");
const validateRequest = require("../middlewares/validateRequest");

const router = express.Router();

// Notifications are always scoped to the signed-in user by the service.
router.use(protect);

router.get(
  "/",
  [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 100 }),
    query("unread").optional().isBoolean(),
  ],
  validateRequest,
  notificationController.getNotifications
);

router.get("/unread-count", notificationController.getUnreadCount);

router.patch("/read-all", notificationController.markAllRead);

router.patch(
  "/:notificationId/read",
  [param("notificationId").isMongoId().withMessage("Invalid notification id.")],
  validateRequest,
  notificationController.markRead
);

module.exports = router;
