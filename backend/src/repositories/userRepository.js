const { ROLES } = require("../constants/roles");
const User = require("../models/User");

/**
 * Repository Pattern — user persistence.
 *
 * Every Mongoose call touching users lives here. Callers above express intent
 * ("find the active patient with this id") and never construct queries, which
 * keeps the persistence engine replaceable and the service layer mockable.
 *
 * NOTE ON `select`: `password` and `isActive` are `select: false` on the
 * schema, so they must be requested explicitly. The method names below say
 * plainly when sensitive fields are being pulled in, so a reviewer can see at
 * a glance which call sites handle credentials.
 */

// --- Creation --------------------------------------------------------------

const create = (payload) => User.create(payload);

// --- Reads -----------------------------------------------------------------

const findById = (userId) => User.findById(userId).exec();

/** Includes `isActive`, which the schema hides by default. */
const findByIdWithStatus = (userId) => User.findById(userId).select("+isActive").exec();

/** Includes the password hash. Only the credential flows should call this. */
const findByIdWithCredentials = (userId) =>
  User.findById(userId).select("+password +isActive").exec();

/**
 * Includes the sealed TOTP secret and the backup-code hashes. Only the MFA
 * flows should call this — everything else must not be able to read the
 * material needed to mint valid second-factor codes.
 */
const findByIdWithMfa = (userId) =>
  User.findById(userId)
    .select("+isActive +mfa.secret +mfa.pendingSecret +mfa.backupCodes")
    .exec();

const findByEmailWithStatus = (email) =>
  User.findOne({ email: String(email).toLowerCase() }).select("+isActive").exec();

/** Includes the password hash. Used by sign-in only. */
const findByEmailWithCredentials = (email) =>
  User.findOne({ email: String(email).toLowerCase() }).select("+password +isActive").exec();

const findActiveById = (userId) => User.findById(userId).select("+isActive").exec();

const findActivePatientById = async (patientId) => {
  const user = await User.findOne({ _id: patientId, role: ROLES.PATIENT })
    .select("+isActive")
    .exec();

  return user && user.isActive ? user : null;
};

const findDoctorById = (doctorId) =>
  User.findOne({ _id: doctorId, role: ROLES.DOCTOR }).select("+isActive").exec();

const existsById = (userId) => User.exists({ _id: userId });

// --- Updates ---------------------------------------------------------------

const updateById = (userId, updates) =>
  User.findByIdAndUpdate(userId, updates, { new: true, runValidators: true }).exec();

/**
 * Persists a document the caller already mutated.
 *
 * `validateBeforeSave: false` is intentional and safe here: these paths change
 * a single flag or timestamp on a document that was loaded from the database
 * and already valid. Full validation would fail on unrelated required fields
 * that were excluded by the projection.
 */
const save = (document) => document.save({ validateBeforeSave: false });

/** Runs the schema's pre-save hook, which is what re-hashes a changed password. */
const saveWithHooks = (document) => document.save();

// --- Listing ---------------------------------------------------------------

const paginate = async (filter, pagination, sort = { createdAt: -1 }) => {
  const [users, totalItems] = await Promise.all([
    User.find(filter)
      .select("+isActive")
      .sort(sort)
      .skip(pagination.skip)
      .limit(pagination.limit)
      .exec(),
    User.countDocuments(filter),
  ]);

  return { users, totalItems };
};

/**
 * Narrow projection for the doctor directory, which any signed-in user can
 * read. Professional details only — never contact details or account metadata.
 */
const findVerifiedDoctors = async (filter, pagination) => {
  const [doctors, totalItems] = await Promise.all([
    User.find(filter)
      .select(
        "name doctorProfile.specialization doctorProfile.qualification " +
          "doctorProfile.hospitalName doctorProfile.experienceYears"
      )
      .sort({ name: 1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
      .lean()
      .exec(),
    User.countDocuments(filter),
  ]);

  return { doctors, totalItems };
};

const countByFilter = (filter) => User.countDocuments(filter);

const aggregate = (pipeline) => User.aggregate(pipeline);

module.exports = {
  aggregate,
  countByFilter,
  create,
  existsById,
  findActiveById,
  findActivePatientById,
  findByEmailWithCredentials,
  findByEmailWithStatus,
  findById,
  findByIdWithCredentials,
  findByIdWithMfa,
  findByIdWithStatus,
  findDoctorById,
  findVerifiedDoctors,
  paginate,
  save,
  saveWithHooks,
  updateById,
};
