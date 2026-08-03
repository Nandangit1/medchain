const {
  RECORD_TYPE_TO_FHIR,
  RECORD_TYPE_TO_LOINC,
  normaliseAbhaNumber,
} = require("../constants/abdm");
const { env } = require("../config/env");

/**
 * FHIR R4 projection.
 *
 * ABDM mandates HL7 FHIR R4 with India-specific profiles for anything that
 * crosses a system boundary. This is a pure mapping layer: nothing is stored
 * in FHIR form, and no schema changed to accommodate it. The internal models
 * stay the shape the application needs, and this file translates on the way
 * out -- which is why adding it required no migration.
 *
 * Only the resources the platform actually holds data for are produced. A
 * mapping that invents fields to look complete is worse than a partial one,
 * because a consumer cannot tell which values are real.
 */

const SYSTEMS = Object.freeze({
  ABHA_NUMBER: "https://healthid.abdm.gov.in/ns/abha-number",
  ABHA_ADDRESS: "https://healthid.abdm.gov.in/ns/abha-address",
  LOINC: "http://loinc.org",
  SNOMED: "http://snomed.info/sct",
  ICD10: "http://hl7.org/fhir/sid/icd-10",
  MEDICAL_LICENCE: "https://hpr.abdm.gov.in/ns/licence",
  RECORD_HASH: "urn:medchain:sha256",
  CHAIN_ANCHOR: "urn:medchain:anchor",
});

/** FHIR wants YYYY-MM-DD for a birth date, not an ISO timestamp. */
const toFhirDate = (value) => (value ? new Date(value).toISOString().slice(0, 10) : undefined);
const toFhirInstant = (value) => (value ? new Date(value).toISOString() : undefined);

/** Drops undefined keys so the JSON stays valid FHIR rather than a sparse object. */
const compact = (object) =>
  Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));

const humanName = (user) => {
  const parts = String(user.name || "").trim().split(/\s+/);
  return compact({
    text: user.name,
    family: parts.length > 1 ? parts[parts.length - 1] : undefined,
    given: parts.length > 1 ? parts.slice(0, -1) : [user.name],
  });
};

const telecom = (user) =>
  [
    user.email ? { system: "email", value: user.email } : null,
    user.phone ? { system: "phone", value: user.phone } : null,
  ].filter(Boolean);

const identifiers = (user) => {
  const list = [];

  if (user.abha?.number) {
    list.push({
      system: SYSTEMS.ABHA_NUMBER,
      value: normaliseAbhaNumber(user.abha.number),
      // Unverified links are still emitted, flagged so a consumer can tell.
      use: user.abha.verified ? "official" : "temp",
    });
  }

  if (user.abha?.address) {
    list.push({ system: SYSTEMS.ABHA_ADDRESS, value: user.abha.address, use: "usual" });
  }

  return list.length ? list : undefined;
};

const toPatient = (user) =>
  compact({
    resourceType: "Patient",
    id: String(user._id),
    identifier: identifiers(user),
    active: user.isActive !== false,
    name: [humanName(user)],
    telecom: telecom(user),
    gender: user.gender || undefined,
    birthDate: toFhirDate(user.dateOfBirth),
    address: user.address?.city
      ? [
          compact({
            city: user.address.city,
            state: user.address.state,
            postalCode: user.address.postalCode,
            country: user.address.country,
          }),
        ]
      : undefined,
  });

const toPractitioner = (user) =>
  compact({
    resourceType: "Practitioner",
    id: String(user._id),
    identifier: user.doctorProfile?.medicalLicenseNumber
      ? [{ system: SYSTEMS.MEDICAL_LICENCE, value: user.doctorProfile.medicalLicenseNumber }]
      : undefined,
    active: user.isActive !== false,
    name: [humanName(user)],
    telecom: telecom(user),
    qualification: user.doctorProfile?.specialization
      ? [{ code: { text: user.doctorProfile.specialization } }]
      : undefined,
  });

/**
 * A record becomes a DocumentReference — FHIR's wrapper for "a document exists,
 * here is what it is and where to get it".
 *
 * The plaintext SHA-256 and the chain anchor travel as identifiers. That is the
 * whole point of this platform expressed in FHIR: a recipient can verify the
 * document they received is byte-identical to the one that was anchored,
 * without trusting this server.
 */
const toDocumentReference = (record, { patientId } = {}) => {
  const loinc = RECORD_TYPE_TO_LOINC[record.recordType] || RECORD_TYPE_TO_LOINC.other;

  const identifier = [
    { system: SYSTEMS.RECORD_HASH, value: record.integrity?.fileHash },
  ];

  if (record.blockchain?.txHash) {
    identifier.push({
      system: SYSTEMS.CHAIN_ANCHOR,
      value: record.blockchain.txHash,
      // The on-chain id is what a verifier queries the contract with.
      assigner: { display: `onChainId:${record.blockchain.onChainId}` },
    });
  }

  return compact({
    resourceType: "DocumentReference",
    id: String(record._id),
    identifier,
    status: record.isDeleted ? "entered-in-error" : "current",
    // The FHIR resource this document stands for, kept as a coding so a
    // consumer can route it without parsing the title.
    category: [{ text: RECORD_TYPE_TO_FHIR[record.recordType] || "DocumentReference" }],
    type: {
      coding: [{ system: SYSTEMS.LOINC, code: loinc.code, display: loinc.display }],
      text: record.recordType,
    },
    subject: { reference: `Patient/${patientId ?? record.patient}` },
    date: toFhirInstant(record.recordDate || record.createdAt),
    description: record.description || record.title,
    content: [
      {
        attachment: compact({
          contentType: record.file?.mimeType,
          title: record.file?.originalName || record.title,
          size: record.file?.size,
          // base64 of the SHA-256, which is how FHIR expresses a digest.
          hash: record.integrity?.fileHash
            ? Buffer.from(record.integrity.fileHash, "hex").toString("base64")
            : undefined,
          creation: toFhirInstant(record.createdAt),
          // Not the IPFS gateway: the file is encrypted at rest and only this
          // endpoint applies the access checks that decide who may decrypt it.
          url: `${env.APP_URL}/api/v1/records/${record._id}/download`,
        }),
      },
    ],
  });
};

const toCondition = (diagnosis) =>
  compact({
    resourceType: "Condition",
    id: String(diagnosis._id),
    clinicalStatus: { coding: [{ code: "active" }] },
    code: compact({
      coding: diagnosis.icdCode
        ? [{ system: SYSTEMS.ICD10, code: diagnosis.icdCode }]
        : undefined,
      text: diagnosis.summary,
    }),
    subject: { reference: `Patient/${diagnosis.patient?._id ?? diagnosis.patient}` },
    recorder: { reference: `Practitioner/${diagnosis.doctor?._id ?? diagnosis.doctor}` },
    severity: diagnosis.severity ? { text: diagnosis.severity } : undefined,
    note: diagnosis.details ? [{ text: diagnosis.details }] : undefined,
    recordedDate: toFhirInstant(diagnosis.createdAt),
  });

const FHIR_APPOINTMENT_STATUS = Object.freeze({
  requested: "proposed",
  confirmed: "booked",
  completed: "fulfilled",
  cancelled: "cancelled",
  no_show: "noshow",
});

const toAppointment = (appointment) =>
  compact({
    resourceType: "Appointment",
    id: String(appointment._id),
    status: FHIR_APPOINTMENT_STATUS[appointment.status] || "proposed",
    description: appointment.reason,
    start: toFhirInstant(appointment.scheduledFor),
    end: appointment.scheduledFor
      ? toFhirInstant(
          new Date(
            new Date(appointment.scheduledFor).getTime() +
              (appointment.durationMinutes || 30) * 60_000
          )
        )
      : undefined,
    minutesDuration: appointment.durationMinutes,
    participant: [
      {
        actor: { reference: `Patient/${appointment.patient?._id ?? appointment.patient}` },
        status: "accepted",
      },
      {
        actor: { reference: `Practitioner/${appointment.doctor?._id ?? appointment.doctor}` },
        status: appointment.status === "requested" ? "tentative" : "accepted",
      },
    ],
  });

/**
 * An access grant as a FHIR Consent — the resource ABDM's consent artefact is
 * built on. `provision.period` carries the time bound, `purpose` the scope.
 */
const toConsent = (permission) =>
  compact({
    resourceType: "Consent",
    id: String(permission._id),
    status: permission.revokedAt ? "inactive" : "active",
    scope: { coding: [{ code: "patient-privacy" }] },
    category: [{ coding: [{ system: SYSTEMS.LOINC, code: "59284-0", display: "Consent" }] }],
    patient: { reference: `Patient/${permission.patient?._id ?? permission.patient}` },
    dateTime: toFhirInstant(permission.grantedAt),
    provision: compact({
      type: "permit",
      period: compact({
        start: toFhirInstant(permission.grantedAt),
        end: toFhirInstant(permission.expiresAt || permission.revokedAt),
      }),
      actor: [
        {
          role: { coding: [{ code: "PRCP", display: "Recipient" }] },
          reference: { reference: `Practitioner/${permission.doctor?._id ?? permission.doctor}` },
        },
      ],
      purpose: permission.purpose ? [{ code: permission.purpose }] : undefined,
      data: [
        {
          meaning: "instance",
          reference: { reference: `DocumentReference/${permission.record?._id ?? permission.record}` },
        },
      ],
    }),
    // The distinguishing claim of this platform, stated inside the resource:
    // this consent is anchored on a chain, so it cannot be backdated.
    extension: permission.grantTx?.txHash
      ? [{ url: SYSTEMS.CHAIN_ANCHOR, valueString: permission.grantTx.txHash }]
      : undefined,
  });

/**
 * Wraps resources in a searchset Bundle, which is what a FHIR client expects
 * from a query endpoint.
 */
const toBundle = (resources, { type = "searchset" } = {}) => ({
  resourceType: "Bundle",
  type,
  timestamp: new Date().toISOString(),
  total: resources.length,
  entry: resources.map((resource) => ({
    fullUrl: `${env.APP_URL}/api/v1/fhir/${resource.resourceType}/${resource.id}`,
    resource,
  })),
});

module.exports = {
  SYSTEMS,
  toAppointment,
  toBundle,
  toCondition,
  toConsent,
  toDocumentReference,
  toPatient,
  toPractitioner,
};
