const express = require("express");
const mongoose = require("mongoose");

const blockchainService = require("../services/blockchainService");
const ipfsService = require("../services/ipfs");
const catchAsync = require("../utils/catchAsync");
const { sendSuccess } = require("../utils/sendResponse");

const router = express.Router();

/**
 * Reports every external dependency in one call. `getStatus` never throws, so
 * an unreachable chain shows up as `connected: false` rather than a 500 —
 * the health endpoint has to stay useful precisely when something is broken.
 */
router.get(
  "/",
  catchAsync(async (_req, res) => {
    const blockchain = await blockchainService.getStatus();

    sendSuccess(res, 200, "API is healthy.", {
      service: "blockchain-telemedicine-api",
      database: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
      ipfs: { driver: ipfsService.name },
      blockchain,
      timestamp: new Date().toISOString(),
    });
  })
);

module.exports = router;
