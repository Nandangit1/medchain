const patientService = require("../services/patientService");
const catchAsync = require("../utils/catchAsync");
const { sendSuccess } = require("../utils/sendResponse");

exports.getDashboard = catchAsync(async (req, res) => {
  const dashboard = await patientService.getDashboard({ actor: req.user });

  sendSuccess(res, 200, "Patient dashboard fetched successfully.", { dashboard });
});

exports.getWallet = catchAsync(async (req, res) => {
  const wallet = await patientService.getWallet({ actor: req.user });

  sendSuccess(res, 200, "Wallet details fetched successfully.", { wallet });
});
