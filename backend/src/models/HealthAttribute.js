const mongoose = require("mongoose");

/**
 * A single structured claim a patient can prove something about --
 * "HbA1c = 6.4 %", "age = 31", "vaccinated = 1".
 *
 * Separate from MedicalRecord on purpose. A record is an opaque encrypted file;
 * this is a number the patient has chosen to make provable. Keeping them apart
 * means committing to a value never implies exposing the document it came from.
 *
 * `value` and `salt` are `select: false`: together they open the commitment, so
 * an accidental `find()` must not return the pair that reveals the measurement.
 */
const healthAttributeSchema = new mongoose.Schema(
  {
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    /** Optional provenance: the report this measurement was read from. */
    record: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MedicalRecord",
      default: null,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 40,
    },
    label: { type: String, trim: true, maxlength: 80 },
    unit: { type: String, trim: true, maxlength: 20 },

    value: { type: Number, required: true, select: false },
    salt: { type: String, required: true, select: false },

    /**
     * Poseidon(value, salt). Public by design -- it is what a verifier checks
     * against, and it reveals nothing without the salt.
     */
    commitment: { type: String, required: true, index: true },

    /** LOINC code, so the claim means the same thing to an outside system. */
    loincCode: { type: String, trim: true, maxlength: 20 },

    measuredAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

/** One live commitment per (patient, attribute): the latest measurement wins. */
healthAttributeSchema.index({ patient: 1, name: 1 }, { unique: true });

healthAttributeSchema.methods.toClientObject = function toClientObject() {
  return {
    _id: this._id,
    name: this.name,
    label: this.label,
    unit: this.unit,
    commitment: this.commitment,
    loincCode: this.loincCode,
    measuredAt: this.measuredAt,
    createdAt: this.createdAt,
  };
};

module.exports = mongoose.model("HealthAttribute", healthAttributeSchema);
