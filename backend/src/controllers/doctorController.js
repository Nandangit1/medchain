const doctorService = require("../services/doctorService");
const catchAsync = require("../utils/catchAsync");
const { sendSuccess } = require("../utils/sendResponse");

exports.getDirectory = catchAsync(async (req, res) => {
  const result = await doctorService.listDirectory({ query: req.query });

  sendSuccess(res, 200, "Verified doctors fetched successfully.", result);
});

exports.getDashboard = catchAsync(async (req, res) => {
  const dashboard = await doctorService.getDashboard({ actor: req.user });

  sendSuccess(res, 200, "Doctor dashboard fetched successfully.", { dashboard });
});

exports.getPatients = catchAsync(async (req, res) => {
  const patients = await doctorService.listPatients({ actor: req.user });

  sendSuccess(res, 200, "Shared patients fetched successfully.", { patients });
});

exports.getSharedRecords = catchAsync(async (req, res) => {
  const result = await doctorService.listSharedRecords({ actor: req.user, query: req.query });

  sendSuccess(res, 200, "Shared records fetched successfully.", result);
});

exports.createDiagnosis = catchAsync(async (req, res) => {
  const diagnosis = await doctorService.createDiagnosis({
    actor: req.user,
    recordId: req.params.recordId,
    payload: req.body,
  });

  sendSuccess(res, 201, "Diagnosis recorded successfully.", { diagnosis });
});

exports.getRecordDiagnoses = catchAsync(async (req, res) => {
  const diagnoses = await doctorService.listRecordDiagnoses({
    actor: req.user,
    recordId: req.params.recordId,
  });

  sendSuccess(res, 200, "Diagnoses fetched successfully.", { diagnoses });
});

exports.getMyDiagnoses = catchAsync(async (req, res) => {
  const result = await doctorService.listMyDiagnoses({ actor: req.user, query: req.query });

  sendSuccess(res, 200, "Diagnoses fetched successfully.", result);
});

exports.uploadPrescription = catchAsync(async (req, res) => {
  const record = await doctorService.uploadPrescription({
    actor: req.user,
    patientId: req.params.patientId,
    file: req.file,
    payload: req.body,
  });

  sendSuccess(res, 201, "Prescription uploaded and anchored successfully.", { record });
});
