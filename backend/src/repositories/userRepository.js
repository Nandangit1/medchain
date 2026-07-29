const { ROLES } = require("../constants/roles");
const User = require("../models/User");

/**
 * Repository Pattern — user persistence.
 *
 * Introduced alongside the medical-record repository so the record service can
 * resolve and validate a patient without importing the User model directly.
 * The auth and admin controllers written in Modules 1-2 will be migrated onto
 * this repository during the Module 11 hardening pass.
 */
const findActiveById = (userId) =>
  User.findById(userId).select("+isActive").exec();

const findActivePatientById = async (patientId) => {
  const user = await User.findOne({ _id: patientId, role: ROLES.PATIENT })
    .select("+isActive")
    .exec();

  return user && user.isActive ? user : null;
};

const existsById = (userId) => User.exists({ _id: userId });

module.exports = {
  existsById,
  findActiveById,
  findActivePatientById,
};
