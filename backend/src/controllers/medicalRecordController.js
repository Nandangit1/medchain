const medicalRecordService = require("../services/medicalRecordService");
const catchAsync = require("../utils/catchAsync");
const { sendSuccess } = require("../utils/sendResponse");

/**
 * Medical Record Controller.
 *
 * Strictly an HTTP adapter: it unpacks the request, delegates to the service
 * layer, and shapes the response. It contains no business rules, no
 * authorization logic and no database access.
 */

exports.uploadRecord = catchAsync(async (req, res) => {
  const record = await medicalRecordService.uploadRecord({
    actor: req.user,
    file: req.file,
    payload: req.body,
  });

  sendSuccess(res, 201, "Medical record uploaded and pinned successfully.", { record });
});

exports.getRecords = catchAsync(async (req, res) => {
  const result = await medicalRecordService.listRecords({
    actor: req.user,
    query: req.query,
  });

  sendSuccess(res, 200, "Medical records fetched successfully.", result);
});

exports.getRecordById = catchAsync(async (req, res) => {
  const record = await medicalRecordService.getRecordById({
    actor: req.user,
    recordId: req.params.recordId,
  });

  sendSuccess(res, 200, "Medical record fetched successfully.", { record });
});

/**
 * Streams the decrypted document. The response is intentionally not wrapped in
 * the standard JSON envelope because the body is the file itself.
 */
exports.downloadRecord = catchAsync(async (req, res) => {
  const { buffer, record } = await medicalRecordService.downloadRecord({
    actor: req.user,
    recordId: req.params.recordId,
  });

  res.set({
    "Content-Type": record.file.mimeType,
    "Content-Length": buffer.length,
    "Content-Disposition": `attachment; filename="${encodeURIComponent(record.file.originalName)}"`,
    // Decrypted clinical data must never be cached by a proxy or the browser.
    "Cache-Control": "no-store, no-cache, must-revalidate, private",
    "X-Content-Type-Options": "nosniff",
    "X-Record-Integrity-Hash": record.integrity.fileHash,
  });

  res.status(200).send(buffer);
});

exports.verifyRecordIntegrity = catchAsync(async (req, res) => {
  const report = await medicalRecordService.verifyRecordIntegrity({
    actor: req.user,
    recordId: req.params.recordId,
  });

  sendSuccess(
    res,
    200,
    report.integrityVerified
      ? "Integrity verified: the stored file matches its recorded hash."
      : "Integrity check failed. See the report for details.",
    { report }
  );
});

exports.updateRecord = catchAsync(async (req, res) => {
  const record = await medicalRecordService.updateRecordMetadata({
    actor: req.user,
    recordId: req.params.recordId,
    payload: req.body,
  });

  sendSuccess(res, 200, "Medical record updated successfully.", { record });
});

exports.deleteRecord = catchAsync(async (req, res) => {
  const result = await medicalRecordService.deleteRecord({
    actor: req.user,
    recordId: req.params.recordId,
  });

  sendSuccess(res, 200, "Medical record deleted successfully.", result);
});
