const mongoose = require("mongoose");

/**
 * A doctor's clinical opinion on a record the patient shared with them.
 *
 * Stored in MongoDB rather than on IPFS because it is short, structured and
 * searchable. Nothing here reaches the blockchain — a diagnosis is exactly the
 * kind of content that must never be written to a permanent public ledger.
 */
const diagnosisSchema = new mongoose.Schema(
  {
    /**
     * The report this diagnosis was made against, when there is one.
     *
     * Optional since the ambient scribe: a diagnosis now has two origins --
     * a doctor reviewing an uploaded record, or a doctor signing a note from a
     * consultation, where no document exists to point at. Callers that need
     * the record must handle null rather than assume it.
     */
    record: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MedicalRecord",
      default: null,
      index: true,
    },
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    doctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    summary: {
      type: String,
      required: [true, "A diagnosis summary is required."],
      trim: true,
      minlength: [5, "Summary must contain at least 5 characters."],
      maxlength: [300, "Summary cannot exceed 300 characters."],
    },
    details: {
      type: String,
      trim: true,
      maxlength: [4000, "Details cannot exceed 4000 characters."],
    },
    /** Optional ICD-10 classification, e.g. "E11.9". */
    icdCode: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 12,
    },
    severity: {
      type: String,
      enum: ["low", "moderate", "high", "critical"],
      default: "moderate",
    },
    followUpAt: Date,
    /** Set when the doctor uploads a prescription alongside the diagnosis. */
    prescriptionRecord: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MedicalRecord",
    },
  },
  { timestamps: true }
);

diagnosisSchema.index({ patient: 1, createdAt: -1 });
diagnosisSchema.index({ doctor: 1, createdAt: -1 });

diagnosisSchema.methods.toClientObject = function toClientObject() {
  const diagnosis = this.toObject();
  delete diagnosis.__v;
  return diagnosis;
};

const Diagnosis = mongoose.model("Diagnosis", diagnosisSchema);

module.exports = Diagnosis;
