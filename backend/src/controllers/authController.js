const logger = require("../config/logger");
const { env } = require("../config/env");
const { AUDIT_ACTIONS, AUDIT_OUTCOMES } = require("../constants/audit");
const { DOCTOR_VERIFICATION_STATUS, ROLES } = require("../constants/roles");
const userRepository = require("../repositories/userRepository");
const auditService = require("../services/auditService");
const tokenService = require("../services/tokenService");
const AppError = require("../utils/AppError");
const catchAsync = require("../utils/catchAsync");
const { signJwt } = require("../utils/jwt");
const { sendSuccess } = require("../utils/sendResponse");

const createTokenPayload = (user) => ({
  id: user._id,
  role: user.role,
});

/**
 * Issues the access token in the body and the refresh token in an httpOnly
 * cookie.
 *
 * The split is deliberate: the access token is short-lived and the client
 * holds it in memory, while the refresh token is unreadable to JavaScript.
 * An XSS payload can therefore steal at most a token that expires shortly,
 * not a week-long session.
 */
const sendAuthResponse = async (res, req, statusCode, user, message) => {
  const token = signJwt(createTokenPayload(user));
  const refreshToken = await tokenService.issueRefreshToken(user, req);

  res.cookie("refreshToken", refreshToken, tokenService.refreshCookieOptions());

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
  const user = await userRepository.create(buildUserPayload(req.body));

  await auditService.record({
    action: AUDIT_ACTIONS.USER_REGISTERED,
    actor: user,
    description: `${user.role} account created`,
    req,
  });

  await sendAuthResponse(res, req, 201, user, "Registration successful.");
});

exports.login = catchAsync(async (req, res, next) => {
  const { email, password } = req.body;

  const user = await userRepository.findByEmailWithCredentials(email);

  if (!user || !(await user.comparePassword(password))) {
    /**
     * The audit entry deliberately records the attempted email but no user
     * reference — there may not be one — and the response stays generic so it
     * cannot be used to enumerate registered addresses.
     */
    await auditService.record({
      action: AUDIT_ACTIONS.USER_LOGIN_FAILED,
      outcome: AUDIT_OUTCOMES.FAILURE,
      description: `Failed sign-in for ${email}`,
      req,
    });

    return next(new AppError("Invalid email or password.", 401));
  }

  if (!user.isActive) {
    await auditService.record({
      action: AUDIT_ACTIONS.USER_LOGIN_FAILED,
      actor: user,
      outcome: AUDIT_OUTCOMES.FAILURE,
      description: "Sign-in attempt on a deactivated account",
      req,
    });

    return next(new AppError("This account has been deactivated.", 403));
  }

  user.lastLoginAt = new Date();
  await userRepository.save(user);

  await auditService.record({
    action: AUDIT_ACTIONS.USER_LOGIN,
    actor: user,
    description: "Signed in",
    req,
  });

  return sendAuthResponse(res, req, 200, user, "Login successful.");
});

/**
 * Exchanges a refresh cookie for a new access token, rotating the refresh
 * token in the process. Reuse of an already-spent token revokes every session
 * for that user — see tokenService.
 */
exports.refresh = catchAsync(async (req, res) => {
  const { user, refreshToken } = await tokenService.rotateRefreshToken(
    req.cookies?.refreshToken,
    req
  );

  res.cookie("refreshToken", refreshToken, tokenService.refreshCookieOptions());

  return sendSuccess(res, 200, "Session refreshed.", {
    token: signJwt(createTokenPayload(user)),
    user: user.toSafeObject(),
  });
});

exports.logout = catchAsync(async (req, res) => {
  await tokenService.revokeRefreshToken(req.cookies?.refreshToken);

  res.clearCookie("refreshToken", { ...tokenService.refreshCookieOptions(), maxAge: undefined });

  if (req.user) {
    await auditService.record({
      action: AUDIT_ACTIONS.USER_LOGOUT,
      actor: req.user,
      description: "Signed out",
      req,
    });
  }

  return sendSuccess(res, 200, "Logout successful.", null);
});

exports.getMe = catchAsync(async (req, res) => {
  sendSuccess(res, 200, "Profile fetched successfully.", {
    user: req.user.toSafeObject(),
  });
});

exports.updateMe = catchAsync(async (req, res, next) => {
  if (req.body.password || req.body.role || req.body.doctorProfile?.verificationStatus) {
    return next(
      new AppError("This route cannot update password, role, or verification status.", 400)
    );
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

  const updatedUser = await userRepository.updateById(req.user._id, updates);

  if (!updatedUser) {
    return next(new AppError("User not found.", 404));
  }

  await auditService.record({
    action: AUDIT_ACTIONS.USER_PROFILE_UPDATED,
    actor: req.user,
    description: `Updated: ${Object.keys(updates).join(", ")}`,
    req,
  });

  return sendSuccess(res, 200, "Profile updated successfully.", {
    user: updatedUser.toSafeObject(),
  });
});

exports.changePassword = catchAsync(async (req, res, next) => {
  const user = await userRepository.findByIdWithCredentials(req.user._id);

  if (!user || !user.isActive) {
    return next(new AppError("User not found.", 404));
  }

  if (!(await user.comparePassword(req.body.currentPassword))) {
    await auditService.record({
      action: AUDIT_ACTIONS.USER_PASSWORD_CHANGED,
      actor: req.user,
      outcome: AUDIT_OUTCOMES.FAILURE,
      description: "Incorrect current password supplied",
      req,
    });

    return next(new AppError("Current password is incorrect.", 401));
  }

  user.password = req.body.newPassword;
  // Hooks must run here — the pre-save hook is what re-hashes the password.
  await userRepository.saveWithHooks(user);

  // Changing a password must invalidate every other session.
  await tokenService.revokeAllForUser(user._id);

  await auditService.record({
    action: AUDIT_ACTIONS.USER_PASSWORD_CHANGED,
    actor: user,
    description: "Password changed; all other sessions revoked",
    req,
  });

  return sendAuthResponse(res, req, 200, user, "Password changed successfully.");
});

/**
 * Starts a password reset.
 *
 * ALWAYS returns the same success response, whether or not the address is
 * registered. Reporting "no such account" would turn this endpoint into a free
 * user-enumeration oracle.
 *
 * There is no mail transport configured, so the link is written to the
 * application log. In development it is also returned in the response to keep
 * the flow testable — never in production.
 */
exports.forgotPassword = catchAsync(async (req, res) => {
  const email = String(req.body.email).toLowerCase();
  const user = await userRepository.findByEmailWithStatus(email);

  const genericResponse = () =>
    sendSuccess(
      res,
      200,
      "If an account exists for that address, a reset link has been sent.",
      env.NODE_ENV === "production" ? null : { note: "Check the server logs for the reset link." }
    );

  if (!user || !user.isActive) {
    logger.info("Password reset requested for an unknown or inactive address", { email });
    return genericResponse();
  }

  const rawToken = await tokenService.issuePasswordResetToken(user, req);
  // APP_URL, not CORS_ORIGIN: the latter is a list and would produce a
  // malformed link the moment more than one origin is allow-listed.
  const resetUrl = `${env.APP_URL}/reset-password?token=${rawToken}`;

  logger.info("Password reset link issued", { userId: String(user._id), resetUrl });

  await auditService.record({
    action: AUDIT_ACTIONS.USER_PASSWORD_RESET_REQUESTED,
    actor: user,
    description: "Password reset requested",
    req,
  });

  if (env.NODE_ENV !== "production") {
    return sendSuccess(res, 200, "If an account exists for that address, a reset link has been sent.", {
      resetUrl,
      expiresInMinutes: tokenService.RESET_TTL_MINUTES,
    });
  }

  return genericResponse();
});

exports.resetPassword = catchAsync(async (req, res) => {
  const user = await tokenService.consumePasswordResetToken(req.body.token);

  const account = await userRepository.findByIdWithCredentials(user._id);
  account.password = req.body.newPassword;
  await userRepository.saveWithHooks(account);

  // A reset means the old credentials may be compromised; drop every session.
  await tokenService.revokeAllForUser(account._id);

  await auditService.record({
    action: AUDIT_ACTIONS.USER_PASSWORD_RESET_COMPLETED,
    actor: account,
    description: "Password reset completed; all sessions revoked",
    req,
  });

  return sendAuthResponse(res, req, 200, account, "Password reset successfully.");
});
