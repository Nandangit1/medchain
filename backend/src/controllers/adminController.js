const { DOCTOR_VERIFICATION_STATUS, ROLES } = require("../constants/roles");
const userRepository = require("../repositories/userRepository");
const adminService = require("../services/adminService");
const auditService = require("../services/auditService");
const blockchainService = require("../services/blockchainService");
const notificationService = require("../services/notificationService");
const { AUDIT_ACTIONS } = require("../constants/audit");
const { NOTIFICATION_TYPES } = require("../constants/notifications");
const AppError = require("../utils/AppError");
const catchAsync = require("../utils/catchAsync");
const { buildPagination, buildPaginationMeta, buildSort } = require("../utils/pagination");
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
  const sort = buildSort(query.sort, ["createdAt", "name", "email", "lastLoginAt"], {
    createdAt: -1,
  });

  const { users, totalItems } = await userRepository.paginate(filter, pagination, sort);

  sendSuccess(res, 200, message, {
    users: users.map((user) => user.toAdminObject()),
    pagination: buildPaginationMeta(totalItems, pagination),
  });
};

exports.getAuditLogs = catchAsync(async (req, res) => {
  const result = await auditService.list(req.query);

  sendSuccess(res, 200, "Audit log fetched successfully.", result);
});

exports.getAuditSummary = catchAsync(async (req, res) => {
  const summary = await auditService.summary(Number(req.query.days) || 30);

  sendSuccess(res, 200, "Audit summary fetched successfully.", { summary });
});

exports.getBlockchainTransactions = catchAsync(async (req, res) => {
  const result = await adminService.listBlockchainTransactions(req.query);

  sendSuccess(res, 200, "Blockchain transactions fetched successfully.", result);
});

exports.getPlatformStats = catchAsync(async (req, res) => {
  const stats = await adminService.getPlatformStats();

  sendSuccess(res, 200, "Platform statistics fetched successfully.", { stats });
});

exports.getUsers = catchAsync(async (req, res) => {
  await sendPaginatedUsers(res, "Users fetched successfully.", buildUserSearchFilter(req.query), req.query);
});

exports.getDoctors = catchAsync(async (req, res) => {
  await sendPaginatedUsers(res, "Doctors fetched successfully.", buildDoctorFilter(req.query), req.query);
});

exports.getUserById = catchAsync(async (req, res, next) => {
  const user = await userRepository.findByIdWithStatus(req.params.userId);

  if (!user) {
    return next(new AppError("User not found.", 404));
  }

  return sendSuccess(res, 200, "User fetched successfully.", {
    user: user.toAdminObject(),
  });
});

exports.verifyDoctor = catchAsync(async (req, res, next) => {
  const doctor = await userRepository.findDoctorById(req.params.doctorId);

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

  await userRepository.save(doctor);

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

  await auditService.record({
    action: AUDIT_ACTIONS.DOCTOR_VERIFIED,
    actor: req.user,
    targetUser: doctor,
    description: `Verified Dr. ${doctor.name} (${doctor.doctorProfile?.medicalLicenseNumber})`,
    req,
  });

  await notificationService.push({
    user: doctor._id,
    type: NOTIFICATION_TYPES.DOCTOR_VERIFIED,
    title: "Your credentials have been verified",
    message: "Patients can now share their medical records with you.",
    link: "/doctor",
  });

  return sendSuccess(res, 200, "Doctor verified successfully.", {
    doctor: doctor.toAdminObject(),
    onChain,
  });
});

exports.rejectDoctor = catchAsync(async (req, res, next) => {
  const doctor = await userRepository.findDoctorById(req.params.doctorId);

  if (!doctor) {
    return next(new AppError("Doctor not found.", 404));
  }

  doctor.doctorProfile.verificationStatus = DOCTOR_VERIFICATION_STATUS.REJECTED;
  doctor.doctorProfile.verifiedBy = req.user._id;
  doctor.doctorProfile.verifiedAt = new Date();
  doctor.doctorProfile.rejectionReason = req.body.rejectionReason;

  await userRepository.save(doctor);

  await auditService.record({
    action: AUDIT_ACTIONS.DOCTOR_REJECTED,
    actor: req.user,
    targetUser: doctor,
    description: `Rejected Dr. ${doctor.name}: ${req.body.rejectionReason}`,
    req,
  });

  await notificationService.push({
    user: doctor._id,
    type: NOTIFICATION_TYPES.DOCTOR_REJECTED,
    title: "Your verification was declined",
    message: req.body.rejectionReason,
    link: "/profile",
  });

  return sendSuccess(res, 200, "Doctor rejected successfully.", {
    doctor: doctor.toAdminObject(),
  });
});

exports.updateUserStatus = catchAsync(async (req, res, next) => {
  if (req.params.userId === String(req.user._id)) {
    return next(new AppError("Admin cannot deactivate their own account.", 400));
  }

  const user = await userRepository.findByIdWithStatus(req.params.userId);

  if (!user) {
    return next(new AppError("User not found.", 404));
  }

  user.isActive = req.body.isActive;
  await userRepository.save(user);

  await auditService.record({
    action: AUDIT_ACTIONS.USER_STATUS_CHANGED,
    actor: req.user,
    targetUser: user,
    description: `${req.body.isActive ? "Activated" : "Deactivated"} ${user.email}`,
    req,
  });

  return sendSuccess(
    res,
    200,
    req.body.isActive ? "User account activated successfully." : "User account deactivated successfully.",
    {
      user: user.toAdminObject(),
    }
  );
});
