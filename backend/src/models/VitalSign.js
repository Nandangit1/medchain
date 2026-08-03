const mongoose = require("mongoose");

/**
 * A time-series vital reading, from a wearable or entered by hand.
 *
 * Deliberately not a MedicalRecord: a record is an encrypted document with an
 * on-chain anchor, and a heart-rate sample every five minutes would be an
 * absurd thing to anchor. Vitals are high-volume, low-stakes individually, and
 * meaningful only as a series.
 */
const VITAL_TYPES = Object.freeze({
  HEART_RATE: "heart_rate",
  BLOOD_PRESSURE: "blood_pressure",
  SPO2: "spo2",
  TEMPERATURE: "temperature",
  RESPIRATORY_RATE: "respiratory_rate",
  BLOOD_GLUCOSE: "blood_glucose",
  WEIGHT: "weight",
  STEPS: "steps",
});

/** LOINC codes, so a reading means the same thing to an outside system. */
const VITAL_LOINC = Object.freeze({
  heart_rate: "8867-4",
  blood_pressure: "85354-9",
  spo2: "59408-5",
  temperature: "8310-5",
  respiratory_rate: "9279-1",
  blood_glucose: "2339-0",
  weight: "29463-7",
  steps: "41950-7",
});

const vitalSignSchema = new mongoose.Schema(
  {
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: { type: String, enum: Object.values(VITAL_TYPES), required: true },
    value: { type: Number, required: true },
    /** Blood pressure is the one reading that needs two numbers. */
    secondaryValue: { type: Number },
    unit: { type: String, required: true, trim: true, maxlength: 20 },
    source: { type: String, trim: true, maxlength: 60, default: "manual" },
    measuredAt: { type: Date, required: true, default: Date.now, index: true },
  },
  { timestamps: true }
);

/** Compound index: every query is "this patient's readings of this type, recently". */
vitalSignSchema.index({ patient: 1, type: 1, measuredAt: -1 });

vitalSignSchema.methods.toClientObject = function toClientObject() {
  return {
    _id: this._id,
    type: this.type,
    value: this.value,
    secondaryValue: this.secondaryValue ?? null,
    unit: this.unit,
    source: this.source,
    loincCode: VITAL_LOINC[this.type] ?? null,
    measuredAt: this.measuredAt,
  };
};

module.exports = mongoose.model("VitalSign", vitalSignSchema);
module.exports.VITAL_TYPES = VITAL_TYPES;
module.exports.VITAL_LOINC = VITAL_LOINC;
