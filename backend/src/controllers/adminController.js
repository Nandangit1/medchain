const { DOCTOR_VERIFICATION_STATUS, ROLES } = require("../constants/roles");
const User = require("../models/User");
const blockchainService = require("../services/blockchainService");
const AppError = require("../utils/AppError");
const catchAsync = require("../utils/catchAsync");
const { buildPagination, buildPaginationMeta } = require("../utils/pagination");
const { sendSuccess } = require("../utils/sendResponse");

const buildUserSearchFilter = (query) => {
  const filter = {};

  if (query.role) {
    filter.role = query.role;
  }

  if (query.isActive !== undefined) {
    filter.isActive = query.isActive === "true";
  }

  if (query.search) {
    const searchRegex = new RegExp(query.search.trim(), "i");
    filter.$or = [{ name: searchRegex }, { email: searchRegex }, { phone: searchRegex }];
  }

  return filter;
};

const buildDoctorFilter = (query) => {
  const filter = {
    role: ROLES.DOCTOR,
  };

  if (query.verificationStatus) {
    filter["doctorProfile.verificationStatus"] = query.verificationStatus;
  }

  if (query.isActive !== undefined) {
    filter.isActive = query.isActive === "true";
  }

  if (query.search) {
    const searchRegex = new RegExp(query.search.trim(), "i");
    filter.$or = [
      { name: searchRegex },
      { email: searchRegex },
      { "doctorProfile.specialization": searchRegex },
      { "doctorProfile.medicalLicenseNumber": searchRegex },
      { "doctorProfile.hospitalName": searchRegex },
    ];
  }

  return filter;
};

const sendPaginatedUsers = async (res, message, filter, query) => {
  const pagination = buildPagination(query);

  const [users, total] = await Promise.all([
    User.find(filter)
      .select("+isActive")
      .sort({ createdAt: -1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
      .exec(),
    User.countDocuments(filter),
  ]);

  sendSuccess(res, 200, message, {
    users: users.map((user) => user.toAdminObject()),
    pagination: buildPaginationMeta(total, pagination),
  });
};

exports.getUsers = catchAsync(async (req, res) => {
  await sendPaginatedUsers(res, "Users fetched successfully.", buildUserSearchFilter(req.query), req.query);
});

exports.getDoctors = catchAsync(async (req, res) => {
  await sendPaginatedUsers(res, "Doctors fetched successfully.", buildDoctorFilter(req.query), req.query);
});

exports.getUserById = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.params.userId).select("+isActive");

  if (!user) {
    return next(new AppError("User not found.", 404));
  }

  return sendSuccess(res, 200, "User fetched successfully.", {
    user: user.toAdminObject(),
  });
});

exports.verifyDoctor = catchAsync(async (req, res, next) => {
  const doctor = await User.findOne({
    _id: req.params.doctorId,
    role: ROLES.DOCTOR,
  }).select("+isActive");

  if (!doctor) {
    return next(new AppError("Doctor not found.", 404));
  }

  if (!doctor.isActive) {
    return next(new AppError("Cannot verify a deactivated doctor account.", 400));
  }

  doctor.doctorProfile.verificationStatus = DOCTOR_VERIFICATION_STATUS.VERIFIED;
  doctor.doctorProfile.verifiedBy = req.user._id;
  doctor.doctorProfile.verifiedAt = new Date();
  doctor.doctorProfile.rejectionReason = undefined;

  await doctor.save({ validateBeforeSave: false });

  /**
   * Mirror the decision on-chain so the contract will accept access grants to
   * this doctor. Best-effort: the off-chain verification stands either way,
   * and grantAccessOnChain re-checks and self-heals if this did not land.
   */
  let onChain = null;

  if (blockchainService.isEnabled()) {
    onChain = await blockchainService
      .verifyDoctorOnChain(doctor, req.user._id)
      .catch((error) => ({ error: error.message }));
  }

  return sendSuccess(res, 200, "Doctor verified successfully.", {
    doctor: doctor.toAdminObject(),
    onChain,
  });
});

exports.rejectDoctor = catchAsync(async (req, res, next) => {
  const doctor = await User.findOne({
    _id: req.params.doctorId,
    role: ROLES.DOCTOR,
  }).select("+isActive");

  if (!doctor) {
    return next(new AppError("Doctor not found.", 404));
  }

  doctor.doctorProfile.verificationStatus = DOCTOR_VERIFICATION_STATUS.REJECTED;
  doctor.doctorProfile.verifiedBy = req.user._id;
  doctor.doctorProfile.verifiedAt = new Date();
  doctor.doctorProfile.rejectionReason = req.body.rejectionReason;

  await doctor.save({ validateBeforeSave: false });

  return sendSuccess(res, 200, "Doctor rejected successfully.", {
    doctor: doctor.toAdminObject(),
  });
});

exports.updateUserStatus = catchAsync(async (req, res, next) => {
  if (req.params.userId === String(req.user._id)) {
    return next(new AppError("Admin cannot deactivate their own account.", 400));
  }

  const user = await User.findById(req.params.userId).select("+isActive");

  if (!user) {
    return next(new AppError("User not found.", 404));
  }

  user.isActive = req.body.isActive;
  await user.save({ validateBeforeSave: false });

  return sendSuccess(
    res,
    200,
    req.body.isActive ? "User account activated successfully." : "User account deactivated successfully.",
    {
      user: user.toAdminObject(),
    }
  );
});
