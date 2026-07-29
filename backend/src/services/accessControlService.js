const { DOCTOR_VERIFICATION_STATUS, ROLES } = require("../constants/roles");
const accessPermissionRepository = require("../repositories/accessPermissionRepository");
const medicalRecordRepository = require("../repositories/medicalRecordRepository");
const userRepository = require("../repositories/userRepository");
const AppError = require("../utils/AppError");
const { buildPagination, buildPaginationMeta } = require("../utils/pagination");
const blockchainService = require("./blockchainService");

/**
 * Access Control Service — Module 5.
 *
 * Owns the sharing lifecycle: a patient grants a verified doctor time-limited
 * access to one record, and can revoke it at any moment.
 *
 * AUTHORISATION IS FAIL-CLOSED AND CHECKED TWICE. MongoDB is consulted first
 * because it is fast and always available; the chain is consulted second as an
 * independent witness. A doctor is admitted only if the database says yes AND
 * the chain does not say no. If the chain is unreachable the database decision
 * stands — the alternative would be an outage locking clinicians out of
 * patient data, which is the wrong failure mode for a medical system.
 *
 * The chain can still veto: if it has recorded a revocation the database
 * somehow missed, access is refused.
 */

const ownerIdOf = (record) => String(record.patient?._id ?? record.patient);

const loadRecordOwnedBy = async (recordId, patientId) => {
  const record = await medicalRecordRepository.findById(recordId);

  if (!record) {
    throw new AppError("Medical record not found.", 404);
  }

  if (ownerIdOf(record) !== String(patientId)) {
    throw new AppError("Only the owning patient can manage access to this record.", 403);
  }

  return record;
};

const loadVerifiedDoctor = async (doctorId) => {
  const doctor = await userRepository.findActiveById(doctorId);

  if (!doctor || doctor.role !== ROLES.DOCTOR) {
    throw new AppError("Doctor not found.", 404);
  }

  if (!doctor.isActive) {
    throw new AppError("This doctor account has been deactivated.", 400);
  }

  if (doctor.doctorProfile?.verificationStatus !== DOCTOR_VERIFICATION_STATUS.VERIFIED) {
    throw new AppError(
      "Access can only be granted to a doctor whose credentials an administrator has verified.",
      400
    );
  }

  return doctor;
};

/**
 * Grants a doctor access to one record.
 *
 * Off-chain first, then on-chain. If the chain write fails the grant survives
 * as `grantTx.status: "failed"` and the doctor can still work — the anchor is
 * an audit record, not the gate.
 */
const grantAccess = async ({ actor, recordId, doctorId, expiresAt, note }) => {
  const record = await loadRecordOwnedBy(recordId, actor._id);
  const doctor = await loadVerifiedDoctor(doctorId);

  if (String(doctor._id) === String(actor._id)) {
    throw new AppError("You cannot grant access to yourself.", 400);
  }

  const existing = await accessPermissionRepository.findActiveRow(recordId, doctorId);

  if (existing && existing.isLive()) {
    throw new AppError("This doctor already has access to this record.", 409);
  }

  if (expiresAt && new Date(expiresAt) <= new Date()) {
    throw new AppError("The expiry date must be in the future.", 400);
  }

  // Carries the expiry into the chain call without widening its signature.
  record.__grantExpiresAt = expiresAt || null;

  let permission;

  if (existing) {
    // A lapsed grant is refreshed in place — the unique index only covers live rows.
    permission = await accessPermissionRepository.updateById(existing._id, {
      grantedAt: new Date(),
      expiresAt: expiresAt || null,
      revokedAt: null,
      revokedBy: null,
      note,
    });
  } else {
    permission = await accessPermissionRepository.create({
      record: record._id,
      patient: actor._id,
      doctor: doctor._id,
      expiresAt: expiresAt || null,
      custodial: true,
      note,
    });
  }

  const grantTx = await blockchainService.grantAccessOnChain({ record, doctor });

  permission.grantTx = grantTx;
  await permission.save();

  return permission.toClientObject();
};

const revokeAccess = async ({ actor, recordId, doctorId }) => {
  const record = await loadRecordOwnedBy(recordId, actor._id);

  const permission = await accessPermissionRepository.findActiveRow(recordId, doctorId);

  if (!permission) {
    throw new AppError("This doctor does not currently have access to this record.", 404);
  }

  const doctor = await userRepository.findActiveById(doctorId);
  const revoked = await accessPermissionRepository.revoke(permission._id, actor._id);

  const revokeTx = await blockchainService.revokeAccessOnChain({ record, doctor });

  revoked.revokeTx = revokeTx;
  await revoked.save();

  return revoked.toClientObject();
};

const listRecordAccess = async ({ actor, recordId }) => {
  await loadRecordOwnedBy(recordId, actor._id);

  const permissions = await accessPermissionRepository.findByRecord(recordId);

  return permissions.map((permission) => permission.toClientObject());
};

const listPatientGrants = async ({ actor, query }) => {
  const pagination = buildPagination(query);

  const { permissions, totalItems } = await accessPermissionRepository.paginateForPatient(
    actor._id,
    pagination
  );

  return {
    permissions: permissions.map((permission) => permission.toClientObject()),
    pagination: buildPaginationMeta(totalItems, pagination),
  };
};

/**
 * The gate used by the record service before decrypting anything for a doctor.
 *
 * @returns {Promise<boolean>}
 */
const doctorCanRead = async (doctor, record) => {
  const permission = await accessPermissionRepository.findLive(record._id, doctor._id);

  if (!permission) {
    return false;
  }

  // The chain may veto, but an unreachable chain must not lock clinicians out.
  const address = doctor.walletAddress || blockchainService.deriveCustodialAddress(doctor._id);
  const onChain = await blockchainService.hasAccessOnChain(record.blockchain?.onChainId, address);

  return onChain === null ? true : onChain;
};

/**
 * Full provenance for one record, read from the chain's event log rather than
 * from MongoDB, so a tampered database cannot rewrite it.
 */
const getRecordHistory = async ({ actor, recordId }) => {
  const record = await medicalRecordRepository.findById(recordId);

  if (!record) {
    throw new AppError("Medical record not found.", 404);
  }

  const isOwner = ownerIdOf(record) === String(actor._id);

  if (!isOwner && actor.role !== ROLES.ADMIN) {
    throw new AppError("You do not have permission to view this record's history.", 403);
  }

  const events = await blockchainService.getRecordHistory(record.blockchain?.onChainId);

  return {
    recordId: String(record._id),
    onChainId: record.blockchain?.onChainId || null,
    anchored: Boolean(record.blockchain?.onChainId),
    txHash: record.blockchain?.txHash || null,
    events,
  };
};

/**
 * Grant issued by the platform rather than by the patient, used when a doctor
 * uploads a document into a patient's chart and must retain read access to it.
 *
 * Recorded as `custodial: true` with an explanatory note, so the audit trail
 * never presents it as something the patient chose.
 */
const grantSystemAccess = async ({ record, patient, doctor }) => {
  const existing = await accessPermissionRepository.findActiveRow(record._id, doctor._id);

  if (existing) {
    return existing;
  }

  const permission = await accessPermissionRepository.create({
    record: record._id,
    patient: patient._id,
    doctor: doctor._id,
    expiresAt: null,
    custodial: true,
    note: "Automatic grant: this document was uploaded by the doctor.",
  });

  const grantTx = await blockchainService.grantAccessOnChain({ record, doctor });
  permission.grantTx = grantTx;
  await permission.save();

  return permission;
};

/** Record ids currently shared with a doctor. Used to scope their listings. */
const listLiveRecordIdsForDoctor = (doctorId) =>
  accessPermissionRepository.findLiveRecordIdsForDoctor(doctorId);

/** Distinct patients who have shared at least one record with this doctor. */
const listDoctorPatients = async ({ actor }) => {
  const permissions = await accessPermissionRepository.findLiveForDoctor(actor._id);

  const byPatient = new Map();

  permissions.forEach((permission) => {
    if (!permission.patient) return;

    const key = String(permission.patient._id);
    const entry = byPatient.get(key) || {
      patient: permission.patient,
      sharedRecords: 0,
      lastSharedAt: permission.grantedAt,
    };

    entry.sharedRecords += 1;
    if (permission.grantedAt > entry.lastSharedAt) {
      entry.lastSharedAt = permission.grantedAt;
    }

    byPatient.set(key, entry);
  });

  return [...byPatient.values()].sort((a, b) => b.lastSharedAt - a.lastSharedAt);
};

module.exports = {
  doctorCanRead,
  getRecordHistory,
  grantAccess,
  grantSystemAccess,
  listDoctorPatients,
  listLiveRecordIdsForDoctor,
  listPatientGrants,
  listRecordAccess,
  revokeAccess,
};
