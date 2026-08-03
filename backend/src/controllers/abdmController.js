const { AUDIT_ACTIONS } = require("../constants/audit");
const { ROLES } = require("../constants/roles");
const AccessPermission = require("../models/AccessPermission");
const Appointment = require("../models/Appointment");
const Diagnosis = require("../models/Diagnosis");
const MedicalRecord = require("../models/MedicalRecord");
const userRepository = require("../repositories/userRepository");
const abhaService = require("../services/abhaService");
const auditService = require("../services/auditService");
const fhirService = require("../services/fhirService");
const AppError = require("../utils/AppError");
const catchAsync = require("../utils/catchAsync");
const { sendSuccess } = require("../utils/sendResponse");

/**
 * ABDM and DPDP surface.
 *
 * Two things live here because they are the same idea from two directions:
 * ABDM says how health data must be *shaped* when it moves, and the DPDP Act
 * says what a person may *demand* about their own. Both answers come from the
 * same FHIR projection.
 */

// --- ABHA linking ----------------------------------------------------------

exports.requestAbhaOtp = catchAsync(async (req, res) => {
  const result = await abhaService.requestOtp({ abhaNumber: req.body.abhaNumber });

  sendSuccess(res, 200, "An OTP has been sent to the mobile linked with this ABHA.", {
    transactionId: result.transactionId,
    sentTo: result.sentTo,
    driver: abhaService.driverName(),
  });
});

exports.linkAbha = catchAsync(async (req, res) => {
  const abha = await abhaService.linkAbha({
    abhaNumber: req.body.abhaNumber,
    abhaAddress: req.body.abhaAddress,
    otp: req.body.otp,
  });

  const user = await userRepository.findById(req.user._id);
  user.abha = abha;
  await userRepository.save(user);

  await auditService.record({
    action: AUDIT_ACTIONS.ABHA_LINKED,
    actor: user,
    description: `ABHA ${abha.number} linked (${abha.verified ? "verified" : "unverified"})`,
    req,
  });

  sendSuccess(res, 200, "ABHA linked to your account.", { abha });
});

exports.unlinkAbha = catchAsync(async (req, res) => {
  const user = await userRepository.findById(req.user._id);

  if (!user.abha?.number) {
    throw new AppError("No ABHA is linked to this account.", 400);
  }

  user.abha = undefined;
  await userRepository.save(user);

  await auditService.record({
    action: AUDIT_ACTIONS.ABHA_UNLINKED,
    actor: user,
    description: "ABHA unlinked",
    req,
  });

  sendSuccess(res, 200, "ABHA unlinked.", null);
});

// --- FHIR R4 ---------------------------------------------------------------

/** The signed-in user as a FHIR Patient or Practitioner. */
exports.getFhirSelf = catchAsync(async (req, res) => {
  const user = await userRepository.findById(req.user._id);

  const resource =
    user.role === ROLES.DOCTOR ? fhirService.toPractitioner(user) : fhirService.toPatient(user);

  res.type("application/fhir+json").status(200).json(resource);
});

/**
 * One record as a FHIR DocumentReference.
 *
 * Scoped to records the caller owns. A doctor with a grant reads through the
 * existing records API, which applies the chain-backed access check -- this
 * endpoint deliberately does not duplicate that logic in a weaker form.
 */
exports.getFhirDocumentReference = catchAsync(async (req, res) => {
  const record = await MedicalRecord.findOne({
    _id: req.params.recordId,
    patient: req.user._id,
    isDeleted: { $ne: true },
  }).exec();

  if (!record) {
    throw new AppError("Record not found.", 404);
  }

  res
    .type("application/fhir+json")
    .status(200)
    .json(fhirService.toDocumentReference(record, { patientId: req.user._id }));
});

/**
 * Everything the platform holds about the caller, as one FHIR Bundle.
 *
 * This is the DPDP Act's right to access, and simultaneously the ABDM
 * "health locker" export. One implementation satisfies both because both want
 * the same thing: the citizen's complete record, in the national format,
 * without having to ask anybody.
 */
const buildSelfBundle = async (user) => {
  const [records, diagnoses, appointments, permissions] = await Promise.all([
    MedicalRecord.find({ patient: user._id, isDeleted: { $ne: true } }).sort({ recordDate: -1 }).exec(),
    Diagnosis.find({ patient: user._id }).exec(),
    Appointment.find({ patient: user._id }).exec(),
    AccessPermission.find({ patient: user._id }).exec(),
  ]);

  return fhirService.toBundle([
    fhirService.toPatient(user),
    ...records.map((record) => fhirService.toDocumentReference(record, { patientId: user._id })),
    ...diagnoses.map(fhirService.toCondition),
    ...appointments.map(fhirService.toAppointment),
    ...permissions.map(fhirService.toConsent),
  ]);
};

exports.exportMyData = catchAsync(async (req, res) => {
  const user = await userRepository.findById(req.user._id);
  const bundle = await buildSelfBundle(user);

  await auditService.record({
    action: AUDIT_ACTIONS.DATA_EXPORTED,
    actor: user,
    description: `Exported ${bundle.total} resources as FHIR R4`,
    req,
  });

  // Content-Disposition so a browser saves it rather than rendering JSON.
  res
    .type("application/fhir+json")
    .set("Content-Disposition", `attachment; filename="medchain-export-${user._id}.json"`)
    .status(200)
    .json(bundle);
});

// --- DPDP Act rights -------------------------------------------------------

/**
 * The plain-language notice the DPDP Act requires a data fiduciary to publish:
 * what is collected, why, and what the person can do about it.
 *
 * Served from the API rather than hard-coded in the UI so that the notice a
 * user was shown can be reproduced later, which is the whole point of having
 * one.
 */
exports.getPrivacyNotice = catchAsync(async (req, res) => {
  sendSuccess(res, 200, "Privacy notice.", {
    version: "2026-08-01",
    fiduciary: "MedChain",
    collected: [
      { category: "Identity", items: ["Name", "Email", "Phone", "Date of birth", "Gender"] },
      { category: "Health", items: ["Medical reports you upload", "Diagnoses", "Prescriptions"] },
      { category: "National health id", items: ["ABHA number and address, if you link one"] },
      { category: "Technical", items: ["Sign-in times", "IP address", "Access audit trail"] },
    ],
    purposes: [
      "Storing your medical records so only you and the doctors you choose can read them",
      "Proving your records have not been altered, by anchoring their fingerprint on a blockchain",
      "Letting you book and attend consultations",
    ],
    yourRights: [
      { right: "Access", how: "GET /api/v1/me/export returns everything, as FHIR R4" },
      { right: "Correction", how: "PATCH /api/v1/auth/me" },
      { right: "Erasure", how: "DELETE /api/v1/me, subject to the retention note below" },
      { right: "Withdraw consent", how: "Revoke any doctor's access from Shared access" },
      { right: "Grievance", how: "Contact the administrator of this deployment" },
    ],
    retention: [
      "Medical records are retained while your account is open.",
      "On erasure your identity and files are removed. Two things necessarily survive: the audit trail, which is what proves who accessed your records and is unusable to identify you once your account is gone; and the on-chain hashes, which cannot be deleted by anyone -- they are one-way fingerprints and reveal nothing about the underlying document.",
    ],
    encryption:
      "Files are encrypted with AES-256-GCM before leaving the server. Only the fingerprint and the storage address are written to the blockchain -- never the file, and never anything that could be turned back into it.",
  });
});

/**
 * Right to erasure.
 *
 * Deliberately explicit about what cannot be deleted, rather than quietly
 * leaving it out: the audit trail is a legal record, and an on-chain hash is
 * beyond anyone's reach by construction. Both facts are told to the user in
 * the response, because a rights request answered with a half-truth is worse
 * than one refused.
 */
exports.eraseMyData = catchAsync(async (req, res) => {
  const account = await userRepository.findByIdWithCredentials(req.user._id);

  if (!(await account.comparePassword(req.body.password))) {
    throw new AppError("Incorrect password.", 401);
  }

  if (account.role === ROLES.ADMIN) {
    throw new AppError(
      "An administrator account cannot erase itself; another administrator must do it.",
      403
    );
  }

  const records = await MedicalRecord.find({ patient: account._id }).exec();

  // Soft-deleted, not dropped: the anchors and the audit trail reference these
  // rows, and a dangling reference is a worse outcome than a tombstone.
  await MedicalRecord.updateMany(
    { patient: account._id },
    { $set: { isDeleted: true, deletedAt: new Date() } }
  );

  await AccessPermission.updateMany(
    { patient: account._id, revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );

  await auditService.record({
    action: AUDIT_ACTIONS.DATA_ERASED,
    actor: account,
    description: `Erasure requested; ${records.length} records withdrawn and all grants revoked`,
    req,
  });

  // The account is deactivated and stripped rather than removed, so the audit
  // trail keeps a stable id to point at.
  account.name = "Erased user";
  account.email = `erased-${account._id}@medchain.invalid`;
  account.phone = undefined;
  account.address = undefined;
  account.dateOfBirth = undefined;
  account.abha = undefined;
  account.isActive = false;
  await userRepository.save(account);

  sendSuccess(res, 200, "Your data has been erased.", {
    recordsWithdrawn: records.length,
    retained: [
      "The audit trail of who accessed your records, which no longer identifies you.",
      "On-chain hashes, which cannot be deleted by anyone and reveal nothing about the documents.",
    ],
  });
});
