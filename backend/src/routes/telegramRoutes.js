const express = require("express");

const telegramController = require("../controllers/telegramController");
const { protect } = require("../middlewares/authMiddleware");

const router = express.Router();

// Called by Telegram, not by a browser; authenticated by its secret header.
router.post("/webhook", telegramController.webhook);

router.use(protect);

router.get("/status", telegramController.getStatus);
router.post("/link", telegramController.createLink);
router.delete("/link", telegramController.unlink);
router.post("/test", telegramController.sendTest);

module.exports = router;
