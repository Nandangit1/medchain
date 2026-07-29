const { RECORD_TYPES } = require("../constants/records");
const { DOCTOR_VERIFICATION_STATUS, ROLES } = require("../constants/roles");
const User = require("../models/User");
const accessPermissionRepository = require("../repositories/accessPermissionRepository");
const diagnosisRepository = require("../repositories/diagnosisRepository");
const medicalRecordRepository = require("../repositories/medicalRecordRepository");
const AppError = require("../utils/AppError");
const { buildPagination, buildPaginationMeta } = require("../utils/pagination");
const accessControlService = require("./accessControlService");
const medicalRecordService = require("./medicalRecordService");

/**
 * Doctor Service — Module 6.
 *
 * Every read here is scoped by a live access grant. A doctor never queries by
 * patient directly; they query the set of records shared with them and the
 * patients are derived from that. This means revoking a share removes the
 * patient from the doctor's view with no extra bookkeeping.
 */

/**
 * Searchable directory of verified doctors.
 *
 * Readable by any signed-in user, because a patient cannot share a record
 * without first finding the doctor. Only verified, active doctors appear, and
 * the projection is deliberately narrow — professional details only, never
 * contact details or account metadata.
 */
const listDirectory = async ({ query }) => {
  const pagination = buildPagination(query);

  const filter = {
    role: ROLES.DOCTOR,
    "doctorProfile.verificationStatus": DOCTOR_VERIFICATION_STATUS.VERIFIED,
  };

  if (query.search && query.search.trim().length >= 2) {
    const searchRegex = new RegExp(query.search.trim(), "i");
    filter.$or = [
      { name: searchRegex },
      { "doctorProfile.specialization": searchRegex },
      { "doctorProfile.hospitalName": searchRegex },
    ];
  }

  const [doctors, totalItems] = await Promise.all([
    User.find(filter)
      .select("name doctorProfile.specialization doctorProfile.qualification doctorProfile.hospitalName doctorProfile.experienceYears")
      .sort({ name: 1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
      .lean()
      .exec(),
    User.countDocuments(filter),
  ]);

  return { doctors, pagination: buildPaginationMeta(totalItems, pagination) };
};

const assertRecordShared = async (doctor, recordId) => {
  const record = await medicalRecordRepository.findById(recordId);

  if (!record) {
    throw new AppError("Medical record not found.", 404);
  }

  if (!(await accessControlService.doctorCanRead(doctor, record))) {
    throw new AppError(
      "The patient has not granted you access to this record, or the grant has expired.",
      403
    );
  }

  return record;
};

const listPatients = async ({ actor }) => {
  const patients = await accessControlService.listDoctorPatients({ actor });

  return patients.map((entry) => ({
    patient: entry.patient,
    sharedRecords: entry.sharedRecords,
    lastSharedAt: entry.lastSharedAt,
  }));
};

const listSharedRecords = async ({ actor, query }) =>
  medicalRecordService.listRecords({ actor, query });

/** Adds a clinical opinion to a record the patient shared. */
const createDiagnosis = async ({ actor, recordId, payload }) => {
  const record = await assertRecordShared(actor, recordId);

  const diagnosis = await diagnosisRepository.create({
    record: record._id,
    patient: record.patient?._id ?? record.patient,
    doctor: actor._id,
    summary: payload.summary,
    details: payload.details,
    icdCode: payload.icdCode,
    severity: payload.severity,
    followUpAt: payload.followUpAt,
  });

  return diagnosis.toClientObject();
};

const listRecordDiagnoses = async ({ actor, recordId }) => {
  await assertRecordShared(actor, recordId);

  const diagnoses = await diagnosisRepository.findByRecord(recordId);

  return diagnoses.map((diagnosis) => diagnosis.toClientObject());
};

const listMyDiagnoses = async ({ actor, query }) => {
  const pagination = buildPagination(query);

  const { diagnoses, totalItems } = await diagnosisRepository.paginate(
    { doctor: actor._id },
    pagination
  );

  return {
    diagnoses: diagnoses.map((diagnosis) => diagnosis.toClientObject()),
    pagination: buildPaginationMeta(totalItems, pagination),
  };
};

/**
 * Uploads a prescription into a patient's chart.
 *
 * Reuses the entire Module 3 pipeline — encrypt, pin, anchor — so a
 * prescription is exactly as tamper-evident as a lab report. It is forced to
 * `recordType: prescription` regardless of what the client sends.
 */
const uploadPrescription = async ({ actor, patientId, file, payload }) => {
  const record = await medicalRecordService.uploadRecordForPatient({
    actor,
    patientId,
    file,
    payload: { ...payload, recordType: RECORD_TYPES.PRESCRIPTION },
  });

  if (payload.diagnosisId) {
    const diagnosis = await diagnosisRepository.findById(payload.diagnosisId);

    if (diagnosis && String(diagnosis.doctor) === String(actor._id)) {
      await diagnosisRepository.updateById(diagnosis._id, { prescriptionRecord: record._id });
    }
  }

  return record;
};

/** Counts for the doctor dashboard. */
const getDashboard = async ({ actor }) => {
  const [patients, permissions, diagnoses] = await Promise.all([
    accessControlService.listDoctorPatients({ actor }),
    accessPermissionRepository.findLiveForDoctor(actor._id),
    diagnosisRepository.paginate({ doctor: actor._id }, { skip: 0, limit: 5 }),
  ]);

  return {
    verificationStatus: actor.doctorProfile?.verificationStatus,
    totalPatients: patients.length,
    sharedRecords: permissions.length,
    totalDiagnoses: diagnoses.totalItems,
    recentDiagnoses: diagnoses.diagnoses.map((diagnosis) => diagnosis.toClientObject()),
    recentPatients: patients.slice(0, 5),
  };
};

module.exports = {
  createDiagnosis,
  getDashboard,
  listDirectory,
  listMyDiagnoses,
  listPatients,
  listRecordDiagnoses,
  listSharedRecords,
  uploadPrescription,
};
