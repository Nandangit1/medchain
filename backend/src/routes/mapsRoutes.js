const express = require("express");

const { env } = require("../config/env");
const { protect } = require("../middlewares/authMiddleware");
const { sendSuccess } = require("../utils/sendResponse");

const router = express.Router();

/**
 * Hands the browser the Google Maps key at runtime.
 *
 * A Maps JavaScript key is public by design -- it ends up in a script URL any
 * visitor can read. Its protection is the HTTP-referrer restriction set in the
 * Google Cloud console, not secrecy. Serving it from here rather than baking it
 * into the bundle means adding or rotating it needs no rebuild.
 */
router.get("/config", protect, (_req, res) => {
  sendSuccess(res, 200, "Maps configuration.", {
    enabled: Boolean(env.GOOGLE_MAPS_API_KEY),
    apiKey: env.GOOGLE_MAPS_API_KEY || null,
    mapId: env.GOOGLE_MAPS_MAP_ID,
  });
});

module.exports = router;
