const logger = require("../config/logger");
const { env } = require("../config/env");
const { AUDIT_ACTIONS, AUDIT_OUTCOMES } = require("../constants/audit");
const { DOCTOR_VERIFICATION_STATUS, ROLES } = require("../constants/roles");
const userRepository = require("../repositories/userRepository");
const auditService = require("../services/auditService");
const mailService = require("../services/mailService");
const mfaService = require("../services/mfaService");
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
const sendAuthResponse = async (res, req, statusCode, user, message, extra = {}) => {
  const token = signJwt(createTokenPayload(user));
  const refreshToken = await tokenService.issueRefreshToken(user, req);

  res.cookie("refreshToken", refreshToken, tokenService.refreshCookieOptions());

  return sendSuccess(res, statusCode, message, {
    token,
    user: user.toSafeObject(),
    /**
     * Lets the client push a doctor or admin straight to enrolment without
     * having to know the server's MFA policy.
     */
    mfaSetupRequired: mfaService.isRequiredFor(user) && !user.mfa?.enabled,
    ...extra,
  });
};

/** Shared tail of both sign-in paths: with a second factor, and without one. */
const completeLogin = async (res, req, user, extra = {}) => {
  user.lastLoginAt = new Date();
  await userRepository.save(user);

  await auditService.record({
    action: AUDIT_ACTIONS.USER_LOGIN,
    actor: user,
    description: user.mfa?.enabled ? "Signed in with two-factor" : "Signed in",
    req,
  });

  return sendAuthResponse(res, req, 200, user, "Login successful.", extra);
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

  /**
   * Password accepted, but not yet a session. When a second factor is enrolled
   * the response carries a short-lived challenge token instead of an access
   * token, and the caller must complete POST /auth/mfa/verify.
   */
  if (user.mfa?.enabled) {
    return sendSuccess(res, 200, "Enter the code from your authenticator app.", {
      mfaRequired: true,
      challengeToken: mfaService.issueChallengeToken(user),
      expiresInSeconds: mfaService.CHALLENGE_TTL_SECONDS,
    });
  }

  if (mfaService.isEnforced() && mfaService.isRequiredFor(user)) {
    return next(
      new AppError(
        "Two-factor authentication is required for this role. Ask an administrator to reset your account so you can enrol.",
        403
      )
    );
  }

  return completeLogin(res, req, user);
});

/**
 * Second leg of an MFA sign-in. Accepts either a 6-digit authenticator code or
 * one single-use backup code.
 */
exports.verifyMfa = catchAsync(async (req, res, next) => {
  const { challengeToken, code } = req.body;

  const userId = mfaService.verifyChallengeToken(challengeToken);
  const user = await userRepository.findByIdWithMfa(userId);

  if (!user || !user.isActive || !user.mfa?.enabled) {
    return next(new AppError("Invalid verification token.", 401));
  }

  const codeAccepted = await mfaService.verifyCode({ sealedSecret: user.mfa.secret, code });
  let usedBackupCode = false;

  if (!codeAccepted) {
    const index = await mfaService.matchBackupCode({
      candidate: code,
      hashedCodes: user.mfa.backupCodes,
    });

    if (index === -1) {
      await auditService.record({
        action: AUDIT_ACTIONS.USER_MFA_FAILED,
        actor: user,
        outcome: AUDIT_OUTCOMES.FAILURE,
        description: "Incorrect two-factor code",
        req,
      });

      return next(new AppError("That code is not valid.", 401));
    }

    // Burned on use. A backup code that still works after being presented once
    // is just a second password.
    user.mfa.backupCodes.splice(index, 1);
    usedBackupCode = true;

    await auditService.record({
      action: AUDIT_ACTIONS.USER_MFA_BACKUP_CODE_USED,
      actor: user,
      description: `Backup code used; ${user.mfa.backupCodes.length} remaining`,
      req,
    });
  }

  user.mfa.lastVerifiedAt = new Date();
  await userRepository.save(user);

  return completeLogin(res, req, user, {
    usedBackupCode,
    backupCodesRemaining: user.mfa.backupCodes?.length ?? 0,
  });
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

/**
 * Moves the account to a new address.
 *
 * Exists chiefly for the administrator: the seeded account starts with
 * whatever ADMIN_EMAIL said on first boot, and password reset now goes by an
 * emailed code -- so the account must point at an inbox its owner reads.
 *
 * The current password is required, so a borrowed unlocked session cannot
 * redirect the reset codes to an attacker's mailbox. The old address is told.
 */
exports.changeEmail = catchAsync(async (req, res, next) => {
  const user = await userRepository.findByIdWithCredentials(req.user._id);

  if (!user || !user.isActive) {
    return next(new AppError("User not found.", 404));
  }

  if (!(await user.comparePassword(req.body.currentPassword))) {
    await auditService.record({
      action: AUDIT_ACTIONS.USER_EMAIL_CHANGED,
      actor: req.user,
      outcome: AUDIT_OUTCOMES.FAILURE,
      description: "Incorrect current password supplied",
      req,
    });

    return next(new AppError("Current password is incorrect.", 401));
  }

  const newEmail = String(req.body.newEmail).toLowerCase();
  const previousEmail = user.email;

  if (newEmail === previousEmail) {
    return next(new AppError("That is already your email address.", 400));
  }

  if (await userRepository.findByEmailWithStatus(newEmail)) {
    return next(new AppError("Another account already uses that email address.", 409));
  }

  user.email = newEmail;
  await userRepository.save(user);

  await auditService.record({
    action: AUDIT_ACTIONS.USER_EMAIL_CHANGED,
    actor: user,
    description: `Email changed from ${previousEmail} to ${newEmail}`,
    req,
  });

  await mailService.send({
    to: previousEmail,
    subject: "Your MedChain email address was changed",
    title: "Email address changed",
    body: `<p>Hello ${user.name},</p>
      <p>Your MedChain sign-in email was changed to <strong>${newEmail}</strong>.
      Password reset codes will go there from now on.</p>
      <p>If this was not you, contact your administrator immediately.</p>`,
  });

  return sendSuccess(res, 200, "Email address updated.", { user: user.toSafeObject() });
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
 * Starts a password reset by emailing a 6-digit one-time code.
 *
 * ALWAYS returns the same success response, whether or not the address is
 * registered. Reporting "no such account" would turn this endpoint into a free
 * user-enumeration oracle.
 *
 * A code rather than a link: it works when the mail is read on a phone and the
 * site is open on a laptop, and it never depends on APP_URL being right.
 *
 * Outside production the code is also returned in the response, so the flow is
 * testable with no mail transport. In production it exists only in the email
 * (and, with MAIL_ENABLED=false, in the server log as a recovery path).
 */
const GENERIC_RESET_MESSAGE =
  "If an account exists for that address, a verification code has been sent to it.";

exports.forgotPassword = catchAsync(async (req, res) => {
  const email = String(req.body.email).toLowerCase();
  const user = await userRepository.findByEmailWithStatus(email);

  const genericResponse = (extra = null) =>
    sendSuccess(res, 200, GENERIC_RESET_MESSAGE, {
      expiresInMinutes: tokenService.OTP_TTL_MINUTES,
      ...(extra || {}),
    });

  if (!user || !user.isActive) {
    logger.info("Password reset requested for an unknown or inactive address", { email });
    return genericResponse();
  }

  const issued = await tokenService.issuePasswordResetOtp(user, req);

  if (issued.throttled) {
    // Same response as a fresh send: a caller must not learn that an account
    // exists from the fact that it is being rate limited.
    logger.info("Password reset code re-requested inside the cooldown", { userId: String(user._id) });
    return genericResponse();
  }

  await auditService.record({
    action: AUDIT_ACTIONS.USER_PASSWORD_RESET_REQUESTED,
    actor: user,
    description: "Password reset code requested",
    req,
  });

  const mail = await mailService.send({
    to: user.email,
    subject: `${issued.code} is your MedChain verification code`,
    title: "Your password reset code",
    body: `<p>Hello ${user.name},</p>
      <p>Use this code to reset your MedChain password:</p>
      <p style="font-size:32px;font-weight:700;letter-spacing:8px;color:#0f766e;
                margin:20px 0;font-family:Consolas,'Courier New',monospace;">${issued.code}</p>
      <p>It expires in ${tokenService.OTP_TTL_MINUTES} minutes and works once. After
      ${tokenService.OTP_MAX_ATTEMPTS} wrong attempts it stops working and you will need a new one.</p>
      <p>If you did not ask for this, ignore this email. Your password stays the same,
      and nobody can change it without this code.</p>`,
  });

  if (!mail.delivered) {
    // The log is the recovery path when mail is off or failing; without it an
    // admin locked out of a fresh deployment has no way back in.
    logger.warn("Password reset code was not emailed", {
      userId: String(user._id),
      reason: mail.reason,
      code: issued.code,
    });
  }

  return genericResponse(env.NODE_ENV !== "production" ? { devOtp: issued.code } : null);
});

/** Second step: email + code + new password. Signs the user in on success. */
exports.resetPassword = catchAsync(async (req, res) => {
  const email = String(req.body.email).toLowerCase();
  const candidate = await userRepository.findByEmailWithStatus(email);

  await tokenService.consumePasswordResetOtp(
    candidate && candidate.isActive ? candidate : null,
    req.body.otp
  );

  const account = await userRepository.findByIdWithCredentials(candidate._id);
  account.password = req.body.newPassword;
  await userRepository.saveWithHooks(account);

  // A reset means the old credentials may be compromised; drop every session.
  await tokenService.revokeAllForUser(account._id);

  await auditService.record({
    action: AUDIT_ACTIONS.USER_PASSWORD_RESET_COMPLETED,
    actor: account,
    description: "Password reset by emailed code; all sessions revoked",
    req,
  });

  await mailService.send({
    to: account.email,
    subject: "Your MedChain password was changed",
    title: "Password changed",
    body: `<p>Hello ${account.name},</p>
      <p>The password for your MedChain account was just reset using a code sent to
      this address. Every other device has been signed out.</p>
      <p>If this was not you, reset it again immediately and tell your administrator.</p>`,
  });

  /**
   * An emailed code proves control of the inbox, not possession of the second
   * factor. Signing an MFA account straight in here would let a compromised
   * mailbox bypass the authenticator entirely, so those accounts go back
   * through the normal two-step sign-in.
   */
  if (account.mfa?.enabled) {
    return sendSuccess(res, 200, "Password reset. Sign in with your new password and authenticator code.", {
      signInRequired: true,
    });
  }

  return sendAuthResponse(res, req, 200, account, "Password reset successfully.");
});

// --- Multi-factor authentication -------------------------------------------

/**
 * Step one of enrolment: mint a secret and hand back a QR code.
 *
 * The secret is stored as `pendingSecret` and does nothing until confirmed.
 * Activating on generation would lock a user out the moment a scan silently
 * failed, which is the classic way MFA rollouts create support tickets.
 */
exports.startMfaEnrolment = catchAsync(async (req, res, next) => {
  const user = await userRepository.findByIdWithMfa(req.user._id);

  if (user.mfa?.enabled) {
    return next(new AppError("Two-factor authentication is already enabled.", 409));
  }

  const enrolment = await mfaService.beginEnrolment({ user });

  user.mfa = { ...(user.mfa?.toObject?.() ?? user.mfa), pendingSecret: enrolment.sealedSecret };
  await userRepository.save(user);

  return sendSuccess(res, 200, "Scan this with your authenticator app.", {
    qrDataUrl: enrolment.qrDataUrl,
    manualEntryKey: enrolment.manualEntryKey,
    otpauth: enrolment.otpauth,
  });
});

/**
 * Step two: a correct code proves the phone holds the secret, so it is
 * promoted and backup codes are issued. The plaintext codes are shown exactly
 * once — only their hashes are kept.
 */
exports.confirmMfaEnrolment = catchAsync(async (req, res, next) => {
  const user = await userRepository.findByIdWithMfa(req.user._id);

  if (user.mfa?.enabled) {
    return next(new AppError("Two-factor authentication is already enabled.", 409));
  }

  if (!user.mfa?.pendingSecret) {
    return next(new AppError("Start enrolment before confirming it.", 400));
  }

  if (!(await mfaService.verifyCode({ sealedSecret: user.mfa.pendingSecret, code: req.body.code }))) {
    return next(new AppError("That code is not valid. Check your device clock and try again.", 400));
  }

  const backupCodes = await mfaService.generateBackupCodes();

  user.mfa.secret = user.mfa.pendingSecret;
  user.mfa.pendingSecret = undefined;
  user.mfa.backupCodes = backupCodes.hashed;
  user.mfa.enabled = true;
  user.mfa.enrolledAt = new Date();
  await userRepository.save(user);

  await auditService.record({
    action: AUDIT_ACTIONS.USER_MFA_ENABLED,
    actor: user,
    description: "Two-factor authentication enabled",
    req,
  });

  await mailService.send({
    to: user.email,
    subject: "Two-factor authentication is on",
    title: "Two-factor authentication enabled",
    body: `<p>Hello ${user.name},</p>
      <p>An authenticator app was just linked to your MedChain account. From now
      on you will be asked for a 6-digit code when you sign in.</p>
      <p>If this was not you, reset your password immediately.</p>`,
  });

  return sendSuccess(res, 200, "Two-factor authentication is now enabled.", {
    // Shown once and never retrievable again.
    backupCodes: backupCodes.plain,
  });
});

/**
 * Turning the second factor off requires the password AND a current code:
 * a hijacked session alone must not be able to remove the control that would
 * have stopped it.
 */
exports.disableMfa = catchAsync(async (req, res, next) => {
  const user = await userRepository.findByIdWithMfa(req.user._id);
  const account = await userRepository.findByIdWithCredentials(req.user._id);

  if (!user.mfa?.enabled) {
    return next(new AppError("Two-factor authentication is not enabled.", 400));
  }

  if (!(await account.comparePassword(req.body.password))) {
    return next(new AppError("Incorrect password.", 401));
  }

  const codeAccepted =
    (await mfaService.verifyCode({ sealedSecret: user.mfa.secret, code: req.body.code })) ||
    (await mfaService.matchBackupCode({
      candidate: req.body.code,
      hashedCodes: user.mfa.backupCodes,
    })) !== -1;

  if (!codeAccepted) {
    return next(new AppError("That code is not valid.", 401));
  }

  if (mfaService.isEnforced() && mfaService.isRequiredFor(user)) {
    return next(
      new AppError("Two-factor authentication is mandatory for your role and cannot be removed.", 403)
    );
  }

  user.mfa = { enabled: false };
  await userRepository.save(user);

  await auditService.record({
    action: AUDIT_ACTIONS.USER_MFA_DISABLED,
    actor: user,
    description: "Two-factor authentication disabled",
    req,
  });

  await mailService.send({
    to: user.email,
    subject: "Two-factor authentication is off",
    title: "Two-factor authentication disabled",
    body: `<p>Hello ${user.name},</p>
      <p>Two-factor authentication was just removed from your MedChain account.</p>
      <p>If this was not you, reset your password immediately.</p>`,
  });

  return sendSuccess(res, 200, "Two-factor authentication disabled.", null);
});

/** Lets the UI render the security page without exposing any secret material. */
exports.mfaStatus = catchAsync(async (req, res) => {
  const user = await userRepository.findByIdWithMfa(req.user._id);

  return sendSuccess(res, 200, "Two-factor status.", {
    enabled: Boolean(user.mfa?.enabled),
    enrolledAt: user.mfa?.enrolledAt ?? null,
    backupCodesRemaining: user.mfa?.backupCodes?.length ?? 0,
    requiredForRole: mfaService.isRequiredFor(user),
    enforced: mfaService.isEnforced(),
  });
});
