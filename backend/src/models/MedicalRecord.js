const mongoose = require("mongoose");

const { BLOCKCHAIN_SYNC_STATUS, RECORD_STATUS, RECORD_TYPES } = require("../constants/records");

/**
 * Describes the plaintext document as the patient uploaded it. `size` is the
 * plaintext size; the encrypted payload is slightly larger and is tracked
 * separately under `storage.encryptedSize`.
 */
const fileSchema = new mongoose.Schema(
  {
    originalName: { type: String, required: true, trim: true, maxlength: 260 },
    mimeType: { type: String, required: true, trim: true, maxlength: 120 },
    extension: { type: String, required: true, trim: true, lowercase: true, maxlength: 10 },
    size: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

const storageSchema = new mongoose.Schema(
  {
    provider: { type: String, required: true, trim: true },
    cid: { type: String, required: true, trim: true, index: true },
    gatewayUrl: { type: String, trim: true },
    encryptedSize: { type: Number, min: 1 },
    pinnedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

/**
 * The digest is taken over the PLAINTEXT bytes, never the ciphertext. This is
 * the value anchored on-chain in Module 4, so a patient can prove the document
 * they hold today is byte-identical to the one they uploaded, independently of
 * how it happened to be encrypted or which storage provider held it.
 */
const integritySchema = new mongoose.Schema(
  {
    algorithm: { type: String, required: true, default: "sha256" },
    fileHash: { type: String, required: true, trim: true, lowercase: true, index: true },
  },
  { _id: false }
);

/**
 * Envelope-encryption parameters. `wrappedKey` is the per-file content key
 * sealed with the server master key (FILE_ENCRYPTION_KEY) — the content key
 * itself is never persisted in the clear.
 */
const encryptionSchema = new mongoose.Schema(
  {
    algorithm: { type: String, required: true, default: "aes-256-gcm" },
    iv: { type: String, required: true },
    authTag: { type: String, required: true },
    wrappedKey: { type: String, required: true },
    keyIv: { type: String, required: true },
    keyAuthTag: { type: String, required: true },
  },
  { _id: false }
);

const blockchainSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: Object.values(BLOCKCHAIN_SYNC_STATUS),
      default: BLOCKCHAIN_SYNC_STATUS.PENDING,
    },
    onChainId: { type: String, trim: true },
    txHash: { type: String, trim: true },
    blockNumber: { type: Number, min: 0 },
    anchoredAt: Date,
    lastError: { type: String, trim: true, maxlength: 500 },
  },
  { _id: false }
);

const medicalRecordSchema = new mongoose.Schema(
  {
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "A medical record must belong to a patient."],
      index: true,
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "A medical record must record its uploader."],
    },
    uploadedByRole: {
      type: String,
      required: true,
    },
    title: {
      type: String,
      required: [true, "Title is required."],
      trim: true,
      minlength: [3, "Title must contain at least 3 characters."],
      maxlength: [140, "Title cannot exceed 140 characters."],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [1000, "Description cannot exceed 1000 characters."],
    },
    recordType: {
      type: String,
      enum: Object.values(RECORD_TYPES),
      required: [true, "Record type is required."],
      index: true,
    },
    recordDate: {
      type: Date,
      default: Date.now,
    },
    tags: {
      type: [{ type: String, trim: true, lowercase: true, maxlength: 30 }],
      default: [],
      validate: [
        (value) => value.length <= 10,
        "A record cannot carry more than 10 tags.",
      ],
    },
    file: { type: fileSchema, required: true },
    storage: { type: storageSchema, required: true },
    integrity: { type: integritySchema, required: true },
    encryption: { type: encryptionSchema, required: true, select: false },
    blockchain: { type: blockchainSchema, default: () => ({}) },
    status: {
      type: String,
      enum: Object.values(RECORD_STATUS),
      default: RECORD_STATUS.ACTIVE,
    },
    /**
     * Soft delete: clinical data is never hard-deleted, because an audit trail
     * that can be erased is not an audit trail.
     */
    isDeleted: {
      type: Boolean,
      default: false,
      select: false,
    },
    deletedAt: { type: Date, select: false },
    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      select: false,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

medicalRecordSchema.index({ patient: 1, createdAt: -1 });
medicalRecordSchema.index({ patient: 1, recordType: 1 });
medicalRecordSchema.index({ "blockchain.status": 1 });

medicalRecordSchema.methods.toClientObject = function toClientObject() {
  const record = this.toObject();
  delete record.encryption;
  delete record.isDeleted;
  delete record.deletedAt;
  delete record.deletedBy;
  delete record.__v;
  return record;
};

const MedicalRecord = mongoose.model("MedicalRecord", medicalRecordSchema);

module.exports = MedicalRecord;
