const bcrypt = require("bcrypt");
const mongoose = require("mongoose");
const { DOCTOR_VERIFICATION_STATUS, ROLES } = require("../constants/roles");
const { WALLET_TYPES } = require("../constants/records");

const addressSchema = new mongoose.Schema(
  {
    line1: { type: String, trim: true, maxlength: 120 },
    line2: { type: String, trim: true, maxlength: 120 },
    city: { type: String, trim: true, maxlength: 80 },
    state: { type: String, trim: true, maxlength: 80 },
    country: { type: String, trim: true, maxlength: 80 },
    postalCode: { type: String, trim: true, maxlength: 20 },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required."],
      trim: true,
      minlength: [2, "Name must contain at least 2 characters."],
      maxlength: [80, "Name cannot exceed 80 characters."],
    },
    email: {
      type: String,
      required: [true, "Email is required."],
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: [120, "Email cannot exceed 120 characters."],
      match: [/^\S+@\S+\.\S+$/, "Please provide a valid email address."],
    },
    password: {
      type: String,
      required: [true, "Password is required."],
      minlength: [8, "Password must contain at least 8 characters."],
      select: false,
    },
    role: {
      type: String,
      enum: Object.values(ROLES),
      required: true,
    },
    phone: {
      type: String,
      trim: true,
      maxlength: [20, "Phone number cannot exceed 20 characters."],
    },
    gender: {
      type: String,
      enum: ["male", "female", "other", "prefer_not_to_say"],
    },
    dateOfBirth: {
      type: Date,
    },
    address: addressSchema,
    patientProfile: {
      bloodGroup: {
        type: String,
        enum: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"],
      },
      emergencyContactName: { type: String, trim: true, maxlength: 80 },
      emergencyContactPhone: { type: String, trim: true, maxlength: 20 },
    },
    doctorProfile: {
      specialization: {
        type: String,
        trim: true,
        maxlength: [100, "Specialization cannot exceed 100 characters."],
        required: function requireSpecialization() {
          return this.role === ROLES.DOCTOR;
        },
      },
      medicalLicenseNumber: {
        type: String,
        trim: true,
        uppercase: true,
        maxlength: [60, "Medical license number cannot exceed 60 characters."],
        required: function requireLicenseNumber() {
          return this.role === ROLES.DOCTOR;
        },
      },
      qualification: { type: String, trim: true, maxlength: 120 },
      experienceYears: { type: Number, min: 0, max: 70 },
      hospitalName: { type: String, trim: true, maxlength: 120 },
      verificationStatus: {
        type: String,
        enum: Object.values(DOCTOR_VERIFICATION_STATUS),
        default: DOCTOR_VERIFICATION_STATUS.PENDING,
      },
      verifiedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
      verifiedAt: Date,
      rejectionReason: { type: String, trim: true, maxlength: 300 },
    },
    /**
     * On-chain identity. Defaults to a deterministic custodial address derived
     * from the user id (see blockchainService.deriveCustodialAddress), which
     * lets records be anchored before the user has ever installed MetaMask.
     * Linking a real wallet flips walletType to "external", after which the
     * user signs their own access grants.
     */
    walletAddress: {
      type: String,
      trim: true,
      lowercase: true,
      match: [/^0x[0-9a-f]{40}$/, "Wallet address must be a valid Ethereum address."],
    },
    walletType: {
      type: String,
      enum: Object.values(WALLET_TYPES),
      default: WALLET_TYPES.CUSTODIAL,
    },
    onChainRegisteredAt: Date,
    isActive: {
      type: Boolean,
      default: true,
      select: false,
    },
    passwordChangedAt: Date,
    lastLoginAt: Date,
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

userSchema.index({ role: 1 });
userSchema.index({ walletAddress: 1 }, { unique: true, sparse: true });
userSchema.index({ "doctorProfile.verificationStatus": 1 });
userSchema.index(
  { "doctorProfile.medicalLicenseNumber": 1 },
  {
    unique: true,
    sparse: true,
    partialFilterExpression: { role: ROLES.DOCTOR },
  }
);

userSchema.pre("save", async function hashPassword(next) {
  if (!this.isModified("password")) {
    return next();
  }

  this.password = await bcrypt.hash(this.password, 12);

  if (!this.isNew) {
    this.passwordChangedAt = new Date(Date.now() - 1000);
  }

  return next();
});

userSchema.methods.comparePassword = function comparePassword(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.changedPasswordAfter = function changedPasswordAfter(jwtIssuedAt) {
  if (!this.passwordChangedAt) {
    return false;
  }

  const changedTimestamp = Math.floor(this.passwordChangedAt.getTime() / 1000);
  return changedTimestamp > jwtIssuedAt;
};

userSchema.methods.toSafeObject = function toSafeObject() {
  const user = this.toObject();
  delete user.password;
  delete user.isActive;
  delete user.__v;
  return user;
};

userSchema.methods.toAdminObject = function toAdminObject() {
  const user = this.toObject();
  delete user.password;
  delete user.__v;
  return user;
};

const User = mongoose.model("User", userSchema);

module.exports = User;
