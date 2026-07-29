const jwt = require("jsonwebtoken");
const { promisify } = require("util");

const { env } = require("../config/env");
const { DOCTOR_VERIFICATION_STATUS, ROLES } = require("../constants/roles");
const User = require("../models/User");
const AppError = require("../utils/AppError");
const catchAsync = require("../utils/catchAsync");

exports.protect = catchAsync(async (req, _res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.split(" ")[1] : null;

  if (!token) {
    return next(new AppError("Authentication token is required.", 401));
  }

  const decoded = await promisify(jwt.verify)(token, env.JWT_SECRET);

  const currentUser = await User.findById(decoded.id).select("+isActive");
  if (!currentUser || !currentUser.isActive) {
    return next(new AppError("The user belonging to this token no longer exists.", 401));
  }

  if (currentUser.changedPasswordAfter(decoded.iat)) {
    return next(new AppError("Password was changed recently. Please log in again.", 401));
  }

  req.user = currentUser;
  return next();
});

exports.authorize = (...roles) => (req, _res, next) => {
  if (!roles.includes(req.user.role)) {
    return next(new AppError("You do not have permission to perform this action.", 403));
  }

  return next();
};

exports.requireVerifiedDoctor = (req, _res, next) => {
  if (req.user.role !== ROLES.DOCTOR) {
    return next(new AppError("Doctor account is required.", 403));
  }

  if (req.user.doctorProfile?.verificationStatus !== DOCTOR_VERIFICATION_STATUS.VERIFIED) {
    return next(new AppError("Doctor account must be verified by an admin.", 403));
  }

  return next();
};
