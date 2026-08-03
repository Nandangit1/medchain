/**
 * Ayushman Bharat Digital Mission (ABDM) vocabulary.
 *
 * India's national health-data standard. Two pieces of it matter here:
 *
 *   ABHA    Ayushman Bharat Health Account — the citizen's national health id.
 *           14 digits, usually written 12-3456-7890-1234, plus a human-readable
 *           "ABHA address" that looks like an email (name@abdm).
 *
 *   Consent A consent artefact is granular, purpose-scoped, time-bound and
 *           revocable. That is exactly the shape of an AccessPermission in this
 *           system, which is why the two map onto each other without a
 *           translation layer -- with one difference worth stating plainly:
 *           ABDM keeps its artefacts in a database, and these are anchored
 *           on-chain, so a grant cannot be backdated or quietly rewritten.
 *
 * Codes are the ones ABDM publishes; do not invent new members.
 */

/** Purpose-of-use, from the ABDM consent artefact specification. */
const CONSENT_PURPOSES = Object.freeze({
  CARE_MANAGEMENT: "CAREMGT",
  BREAK_THE_GLASS: "BTG",
  PUBLIC_HEALTH: "PUBHLTH",
  HEALTHCARE_PAYMENT: "HPAYMT",
  DISEASE_SPECIFIC: "DSRCH",
  SELF_REQUESTED: "PATRQT",
});

const CONSENT_PURPOSE_LABELS = Object.freeze({
  [CONSENT_PURPOSES.CARE_MANAGEMENT]: "Care management",
  [CONSENT_PURPOSES.BREAK_THE_GLASS]: "Emergency access",
  [CONSENT_PURPOSES.PUBLIC_HEALTH]: "Public health",
  [CONSENT_PURPOSES.HEALTHCARE_PAYMENT]: "Healthcare payment",
  [CONSENT_PURPOSES.DISEASE_SPECIFIC]: "Disease-specific research",
  [CONSENT_PURPOSES.SELF_REQUESTED]: "Requested by the patient",
});

/** Health Information types a consent artefact can cover. */
const HI_TYPES = Object.freeze({
  PRESCRIPTION: "Prescription",
  DIAGNOSTIC_REPORT: "DiagnosticReport",
  OP_CONSULTATION: "OPConsultation",
  DISCHARGE_SUMMARY: "DischargeSummary",
  IMMUNIZATION_RECORD: "ImmunizationRecord",
  HEALTH_DOCUMENT: "HealthDocumentRecord",
  WELLNESS_RECORD: "WellnessRecord",
});

/**
 * This platform's record types, expressed as ABDM health-information types.
 * Anything without a specific ABDM equivalent becomes a health document,
 * which is the category ABDM provides for exactly that case.
 */
const RECORD_TYPE_TO_HI_TYPE = Object.freeze({
  lab_report: HI_TYPES.DIAGNOSTIC_REPORT,
  prescription: HI_TYPES.PRESCRIPTION,
  diagnosis: HI_TYPES.OP_CONSULTATION,
  imaging: HI_TYPES.DIAGNOSTIC_REPORT,
  discharge_summary: HI_TYPES.DISCHARGE_SUMMARY,
  vaccination: HI_TYPES.IMMUNIZATION_RECORD,
  insurance: HI_TYPES.HEALTH_DOCUMENT,
  other: HI_TYPES.HEALTH_DOCUMENT,
});

/**
 * FHIR R4 resource for each record type. `DocumentReference` is the wrapper
 * that carries the actual file in every case; this is the *clinical* resource
 * the document represents.
 */
const RECORD_TYPE_TO_FHIR = Object.freeze({
  lab_report: "DiagnosticReport",
  prescription: "MedicationRequest",
  diagnosis: "Condition",
  imaging: "ImagingStudy",
  discharge_summary: "Composition",
  vaccination: "Immunization",
  insurance: "Coverage",
  other: "DocumentReference",
});

/**
 * LOINC document-type codes, which ABDM requires for document classification.
 * 34133-9 ("Summary of episode note") is the general-purpose fallback the
 * specification nominates.
 */
const RECORD_TYPE_TO_LOINC = Object.freeze({
  lab_report: { code: "11502-2", display: "Laboratory report" },
  prescription: { code: "57833-6", display: "Prescription for medication" },
  diagnosis: { code: "11488-4", display: "Consultation note" },
  imaging: { code: "18748-4", display: "Diagnostic imaging report" },
  discharge_summary: { code: "18842-5", display: "Discharge summary" },
  vaccination: { code: "11369-6", display: "History of immunization" },
  insurance: { code: "34133-9", display: "Summary of episode note" },
  other: { code: "34133-9", display: "Summary of episode note" },
});

/** ABHA numbers are 14 digits; the hyphenated form is only for display. */
const ABHA_NUMBER_PATTERN = /^\d{2}-?\d{4}-?\d{4}-?\d{4}$/;
const ABHA_ADDRESS_PATTERN = /^[a-zA-Z0-9._-]{4,}@[a-zA-Z]{3,}$/;

const normaliseAbhaNumber = (value) => String(value || "").replace(/-/g, "");

const formatAbhaNumber = (value) => {
  const digits = normaliseAbhaNumber(value);
  return digits.length === 14
    ? `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6, 10)}-${digits.slice(10)}`
    : value;
};

module.exports = {
  ABHA_ADDRESS_PATTERN,
  ABHA_NUMBER_PATTERN,
  CONSENT_PURPOSES,
  CONSENT_PURPOSE_LABELS,
  HI_TYPES,
  RECORD_TYPE_TO_FHIR,
  RECORD_TYPE_TO_HI_TYPE,
  RECORD_TYPE_TO_LOINC,
  formatAbhaNumber,
  normaliseAbhaNumber,
};
