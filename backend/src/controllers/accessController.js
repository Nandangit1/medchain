const accessControlService = require("../services/accessControlService");
const catchAsync = require("../utils/catchAsync");
const { sendSuccess } = require("../utils/sendResponse");

/** HTTP adapter for the record-sharing lifecycle. */

exports.grantAccess = catchAsync(async (req, res) => {
  const permission = await accessControlService.grantAccess({
    actor: req.user,
    recordId: req.params.recordId,
    doctorId: req.body.doctorId,
    expiresAt: req.body.expiresAt,
    note: req.body.note,
    req,
  });

  sendSuccess(res, 201, "Access granted successfully.", { permission });
});

exports.revokeAccess = catchAsync(async (req, res) => {
  const permission = await accessControlService.revokeAccess({
    actor: req.user,
    recordId: req.params.recordId,
    doctorId: req.params.doctorId,
    req,
  });

  sendSuccess(res, 200, "Access revoked successfully.", { permission });
});

exports.listRecordAccess = catchAsync(async (req, res) => {
  const permissions = await accessControlService.listRecordAccess({
    actor: req.user,
    recordId: req.params.recordId,
  });

  sendSuccess(res, 200, "Record access list fetched successfully.", { permissions });
});

exports.getRecordHistory = catchAsync(async (req, res) => {
  const history = await accessControlService.getRecordHistory({
    actor: req.user,
    recordId: req.params.recordId,
  });

  sendSuccess(res, 200, "Blockchain history fetched successfully.", { history });
});

exports.listMyGrants = catchAsync(async (req, res) => {
  const result = await accessControlService.listPatientGrants({
    actor: req.user,
    query: req.query,
  });

  sendSuccess(res, 200, "Access grants fetched successfully.", result);
});
