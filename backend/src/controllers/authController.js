const User = require("../models/User");
const AppError = require("../utils/AppError");
const catchAsync = require("../utils/catchAsync");
const { signJwt } = require("../utils/jwt");
const { sendSuccess } = require("../utils/sendResponse");
const { DOCTOR_VERIFICATION_STATUS, ROLES } = require("../constants/roles");

const createTokenPayload = (user) => ({
  id: user._id,
  role: user.role,
});

const sendAuthResponse = (res, statusCode, user, message) => {
  const token = signJwt(createTokenPayload(user));

  return sendSuccess(res, statusCode, message, {
    token,
    user: user.toSafeObject(),
  });
};

const buildUserPayload = (body) => {
  const payload = {
    name: body.name,
    email: body.email,
    password: body.password,
    role: body.role,
    phone: body.phone,
    gender: body.gender,
    dateOfBirth: body.dateOfBirth,
    address: body.address,
  };

  if (body.role === ROLES.PATIENT) {
    payload.patientProfile = body.patientProfile || {};
  }

  if (body.role === ROLES.DOCTOR) {
    payload.doctorProfile = {
      ...body.doctorProfile,
      verificationStatus: DOCTOR_VERIFICATION_STATUS.PENDING,
    };
  }

  return payload;
};

exports.register = catchAsync(async (req, res) => {
  const user = await User.create(buildUserPayload(req.body));

  sendAuthResponse(res, 201, user, "Registration successful.");
});

exports.login = catchAsync(async (req, res, next) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email: email.toLowerCase() })
    .select("+password +isActive")
    .exec();

  if (!user || !(await user.comparePassword(password))) {
    return next(new AppError("Invalid email or password.", 401));
  }

  if (!user.isActive) {
    return next(new AppError("This account has been deactivated.", 403));
  }

  user.lastLoginAt = new Date();
  await user.save({ validateBeforeSave: false });

  return sendAuthResponse(res, 200, user, "Login successful.");
});

exports.getMe = catchAsync(async (req, res) => {
  sendSuccess(res, 200, "Profile fetched successfully.", {
    user: req.user.toSafeObject(),
  });
});

exports.updateMe = catchAsync(async (req, res, next) => {
  if (req.body.password || req.body.role || req.body.doctorProfile?.verificationStatus) {
    return next(new AppError("This route cannot update password, role, or verification status.", 400));
  }

  const allowedFields = [
    "name",
    "phone",
    "gender",
    "dateOfBirth",
    "address",
    "patientProfile",
    "doctorProfile",
  ];

  const updates = {};
  allowedFields.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(req.body, field)) {
      updates[field] = req.body[field];
    }
  });

  if (req.user.role !== ROLES.PATIENT) {
    delete updates.patientProfile;
  }

  if (req.user.role !== ROLES.DOCTOR) {
    delete updates.doctorProfile;
  } else if (updates.doctorProfile) {
    delete updates.doctorProfile.verificationStatus;
    delete updates.doctorProfile.verifiedBy;
    delete updates.doctorProfile.verifiedAt;
    delete updates.doctorProfile.rejectionReason;
  }

  const updatedUser = await User.findByIdAndUpdate(req.user._id, updates, {
    new: true,
    runValidators: true,
  });

  if (!updatedUser) {
    return next(new AppError("User not found.", 404));
  }

  return sendSuccess(res, 200, "Profile updated successfully.", {
    user: updatedUser.toSafeObject(),
  });
});

exports.changePassword = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user._id).select("+password +isActive");

  if (!user || !user.isActive) {
    return next(new AppError("User not found.", 404));
  }

  if (!(await user.comparePassword(req.body.currentPassword))) {
    return next(new AppError("Current password is incorrect.", 401));
  }

  user.password = req.body.newPassword;
  await user.save();

  return sendAuthResponse(res, 200, user, "Password changed successfully.");
});

exports.logout = (_req, res) => {
  sendSuccess(res, 200, "Logout successful. Please discard the token on the client.", null);
};
