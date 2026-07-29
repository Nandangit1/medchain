const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { before, describe, it } = require("node:test");

/**
 * Modules 5, 6 and 6b — sharing, doctor workflows and appointments.
 *
 * The security-critical assertions here are the negative ones: an unverified
 * doctor is refused, a doctor with no grant is refused, and a revoked doctor
 * loses access immediately.
 */
const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:5000/api/v1";
const PASSWORD = "Str0ng!Passw0rd";
const runId = crypto.randomBytes(6).toString("hex");

const api = async (endpoint, { method = "GET", token, body, raw = false } = {}) => {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  let payload = body;
  if (body && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  const response = await fetch(`${BASE_URL}${endpoint}`, { method, headers, body: payload });

  return {
    status: response.status,
    body: raw ? Buffer.from(await response.arrayBuffer()) : await response.json().catch(() => null),
  };
};

const register = async (label, role, extra = {}) => {
  const email = `${label}.${runId}@example.com`;

  const response = await api("/auth/register", {
    method: "POST",
    body: { name: `Test ${label}`, email, password: PASSWORD, role, ...extra },
  });

  assert.equal(response.status, 201, `register ${label}: ${JSON.stringify(response.body)}`);

  return { email, token: response.body.data.token, user: response.body.data.user };
};

const doctorProfile = (suffix) => ({
  doctorProfile: {
    specialization: "General Medicine",
    medicalLicenseNumber: `LIC-${runId}-${suffix}`,
  },
});

const buildPdf = (marker) =>
  Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n% ${marker}\n%%EOF\n`, "utf8");

const upload = async (token, buffer, title) => {
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: "application/pdf" }), "report.pdf");
  form.append("title", title);
  form.append("recordType", "lab_report");

  return api("/records", { method: "POST", token, body: form });
};

describe("Modules 5-6 — Sharing, doctors and appointments", () => {
  let patient;
  let otherPatient;
  let verifiedDoctor;
  let unverifiedDoctor;
  let admin;
  let recordId;

  before(async () => {
    patient = await register("share.patient", "patient");
    otherPatient = await register("share.patient2", "patient");
    verifiedDoctor = await register("share.doctor", "doctor", doctorProfile("A"));
    unverifiedDoctor = await register("share.doctor2", "doctor", doctorProfile("B"));

    const login = await api("/auth/login", {
      method: "POST",
      body: {
        email: process.env.ADMIN_EMAIL || "admin@example.com",
        password: process.env.ADMIN_PASSWORD || "Admin@12345",
      },
    });
    assert.equal(login.status, 200, "admin login failed; run npm run seed:admin");
    admin = { token: login.body.data.token };

    const verify = await api(`/admin/doctors/${verifiedDoctor.user._id}/verify`, {
      method: "PATCH",
      token: admin.token,
    });
    assert.equal(verify.status, 200, JSON.stringify(verify.body));

    const uploaded = await upload(patient.token, buildPdf(`share-${runId}`), "Shared blood panel");
    assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
    recordId = uploaded.body.data.record._id;
  });

  // --- Access denial ------------------------------------------------------

  it("denies a doctor with no grant", async () => {
    const meta = await api(`/records/${recordId}`, { token: verifiedDoctor.token });
    assert.equal(meta.status, 403);

    const download = await api(`/records/${recordId}/download`, { token: verifiedDoctor.token });
    assert.equal(download.status, 403);
  });

  it("shows a doctor an empty record list before anything is shared", async () => {
    const response = await api("/records", { token: verifiedDoctor.token });

    assert.equal(response.status, 200);
    assert.equal(response.body.data.records.length, 0);
  });

  it("REFUSES to share with an unverified doctor", async () => {
    const response = await api(`/records/${recordId}/share`, {
      method: "POST",
      token: patient.token,
      body: { doctorId: unverifiedDoctor.user._id },
    });

    assert.equal(response.status, 400);
    assert.match(response.body.message, /verified/i);
  });

  it("REFUSES to let a non-owner share someone else's record", async () => {
    const response = await api(`/records/${recordId}/share`, {
      method: "POST",
      token: otherPatient.token,
      body: { doctorId: verifiedDoctor.user._id },
    });

    assert.equal(response.status, 403);
  });

  it("rejects an expiry in the past", async () => {
    const response = await api(`/records/${recordId}/share`, {
      method: "POST",
      token: patient.token,
      body: {
        doctorId: verifiedDoctor.user._id,
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      },
    });

    assert.equal(response.status, 400);
  });

  // --- Granting -----------------------------------------------------------

  it("grants a verified doctor access", async () => {
    const response = await api(`/records/${recordId}/share`, {
      method: "POST",
      token: patient.token,
      body: { doctorId: verifiedDoctor.user._id, note: "Second opinion" },
    });

    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal(response.body.data.permission.live, true);
    assert.ok(["confirmed", "pending"].includes(response.body.data.permission.grantTx.status));
  });

  it("rejects a duplicate grant", async () => {
    const response = await api(`/records/${recordId}/share`, {
      method: "POST",
      token: patient.token,
      body: { doctorId: verifiedDoctor.user._id },
    });

    assert.equal(response.status, 409);
  });

  it("lets the granted doctor read metadata and the file", async () => {
    const meta = await api(`/records/${recordId}`, { token: verifiedDoctor.token });
    assert.equal(meta.status, 200);

    const download = await api(`/records/${recordId}/download`, {
      token: verifiedDoctor.token,
      raw: true,
    });
    assert.equal(download.status, 200);
    assert.ok(download.body.includes(Buffer.from("%PDF")));
  });

  it("shows the record in the doctor's scoped list", async () => {
    const response = await api("/records", { token: verifiedDoctor.token });

    assert.equal(response.status, 200);
    assert.equal(response.body.data.records.length, 1);
    assert.equal(response.body.data.records[0]._id, recordId);
  });

  it("lists the patient among the doctor's patients", async () => {
    const response = await api("/doctors/me/patients", { token: verifiedDoctor.token });

    assert.equal(response.status, 200);
    assert.equal(response.body.data.patients.length, 1);
    assert.equal(response.body.data.patients[0].patient._id, patient.user._id);
  });

  it("still denies a different doctor", async () => {
    const response = await api(`/records/${recordId}`, { token: unverifiedDoctor.token });
    assert.equal(response.status, 403);
  });

  // --- Doctor clinical workflow -------------------------------------------

  it("records a diagnosis against the shared record", async () => {
    const response = await api(`/doctors/records/${recordId}/diagnoses`, {
      method: "POST",
      token: verifiedDoctor.token,
      body: {
        summary: "Mild iron deficiency anaemia",
        details: "Haemoglobin below reference range. Recommend oral iron.",
        icdCode: "D50.9",
        severity: "moderate",
      },
    });

    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal(response.body.data.diagnosis.icdCode, "D50.9");
  });

  it("rejects an invalid ICD code", async () => {
    const response = await api(`/doctors/records/${recordId}/diagnoses`, {
      method: "POST",
      token: verifiedDoctor.token,
      body: { summary: "Test diagnosis entry", icdCode: "NOT-AN-ICD" },
    });

    assert.equal(response.status, 400);
  });

  it("blocks an unverified doctor from every doctor route", async () => {
    const response = await api("/doctors/me/patients", { token: unverifiedDoctor.token });
    assert.equal(response.status, 403);
  });

  it("uploads a prescription into the patient's chart", async () => {
    const form = new FormData();
    form.append(
      "file",
      new Blob([buildPdf(`rx-${runId}`)], { type: "application/pdf" }),
      "prescription.pdf"
    );
    form.append("title", "Ferrous sulphate 200mg");
    form.append("description", "One tablet twice daily for 8 weeks.");

    const response = await api(`/doctors/patients/${patient.user._id}/prescriptions`, {
      method: "POST",
      token: verifiedDoctor.token,
      body: form,
    });

    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal(response.body.data.record.recordType, "prescription");
    assert.equal(response.body.data.record.uploadedByRole, "doctor");
    assert.equal(response.body.data.record.patient, patient.user._id);
  });

  it("refuses a prescription for a patient who shared nothing", async () => {
    const form = new FormData();
    form.append("file", new Blob([buildPdf("nope")], { type: "application/pdf" }), "rx.pdf");
    form.append("title", "Unauthorised prescription");

    const response = await api(`/doctors/patients/${otherPatient.user._id}/prescriptions`, {
      method: "POST",
      token: verifiedDoctor.token,
      body: form,
    });

    assert.equal(response.status, 403);
  });

  // --- Revocation ---------------------------------------------------------

  it("revokes access and locks the doctor out immediately", async () => {
    const revoked = await api(`/records/${recordId}/share/${verifiedDoctor.user._id}`, {
      method: "DELETE",
      token: patient.token,
    });
    assert.equal(revoked.status, 200);
    assert.equal(revoked.body.data.permission.live, false);

    const meta = await api(`/records/${recordId}`, { token: verifiedDoctor.token });
    assert.equal(meta.status, 403, "revoked doctor must lose metadata access");

    const download = await api(`/records/${recordId}/download`, { token: verifiedDoctor.token });
    assert.equal(download.status, 403, "revoked doctor must lose file access");
  });

  it("returns 404 when revoking a grant that does not exist", async () => {
    const response = await api(`/records/${recordId}/share/${unverifiedDoctor.user._id}`, {
      method: "DELETE",
      token: patient.token,
    });

    assert.equal(response.status, 404);
  });

  it("keeps the revoked grant in the patient's history", async () => {
    const response = await api("/patients/me/grants", { token: patient.token });

    assert.equal(response.status, 200);
    const revokedGrant = response.body.data.permissions.find(
      (permission) => permission.doctor?._id === verifiedDoctor.user._id && permission.revokedAt
    );
    assert.ok(revokedGrant, "revocation must remain in the audit trail");
  });

  // --- Blockchain history --------------------------------------------------

  it("returns the on-chain history for the record", async (t) => {
    const health = await api("/health");
    if (!health.body?.data?.blockchain?.connected) {
      return t.skip("blockchain not enabled");
    }

    const response = await api(`/records/${recordId}/history`, { token: patient.token });

    assert.equal(response.status, 200);
    assert.equal(response.body.data.history.anchored, true);

    const names = response.body.data.history.events.map((event) => event.event);
    assert.ok(names.includes("RecordAnchored"), "history must include the anchor");
    assert.ok(names.includes("AccessGranted"), "history must include the grant");
    assert.ok(names.includes("AccessRevoked"), "history must include the revocation");
  });

  // --- Patient dashboard ---------------------------------------------------

  it("reports patient dashboard aggregates", async () => {
    const response = await api("/patients/me/dashboard", { token: patient.token });

    assert.equal(response.status, 200);
    assert.ok(response.body.data.dashboard.records.total >= 2);
    assert.ok(Array.isArray(response.body.data.dashboard.recordsByType));
  });

  // --- Appointments (6b) ---------------------------------------------------

  describe("Appointments", () => {
    let appointmentId;
    const slot = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

    it("requests an appointment with a verified doctor", async () => {
      const response = await api("/appointments", {
        method: "POST",
        token: patient.token,
        body: {
          doctorId: verifiedDoctor.user._id,
          scheduledFor: slot,
          reason: "Follow-up on blood test results",
        },
      });

      assert.equal(response.status, 201, JSON.stringify(response.body));
      assert.equal(response.body.data.appointment.status, "requested");
      appointmentId = response.body.data.appointment._id;
    });

    it("refuses to book with an unverified doctor", async () => {
      const response = await api("/appointments", {
        method: "POST",
        token: patient.token,
        body: {
          doctorId: unverifiedDoctor.user._id,
          scheduledFor: slot,
          reason: "Should never be created",
        },
      });

      assert.equal(response.status, 400);
    });

    it("refuses a past appointment time", async () => {
      const response = await api("/appointments", {
        method: "POST",
        token: patient.token,
        body: {
          doctorId: verifiedDoctor.user._id,
          scheduledFor: new Date(Date.now() - 3600_000).toISOString(),
          reason: "Time travel consultation",
        },
      });

      assert.equal(response.status, 400);
    });

    it("prevents double-booking the same doctor slot", async () => {
      const response = await api("/appointments", {
        method: "POST",
        token: otherPatient.token,
        body: {
          doctorId: verifiedDoctor.user._id,
          scheduledFor: slot,
          reason: "Clashing appointment request",
        },
      });

      assert.equal(response.status, 409);
    });

    it("refuses to complete an appointment that was never confirmed", async () => {
      const response = await api(`/appointments/${appointmentId}/complete`, {
        method: "PATCH",
        token: verifiedDoctor.token,
        body: { doctorNotes: "Skipping the queue" },
      });

      assert.equal(response.status, 400, "illegal status transition must be rejected");
    });

    it("refuses to let the patient confirm their own appointment", async () => {
      const response = await api(`/appointments/${appointmentId}/confirm`, {
        method: "PATCH",
        token: patient.token,
      });

      assert.equal(response.status, 403);
    });

    it("lets the doctor confirm, then complete", async () => {
      const confirmed = await api(`/appointments/${appointmentId}/confirm`, {
        method: "PATCH",
        token: verifiedDoctor.token,
      });
      assert.equal(confirmed.status, 200);
      assert.equal(confirmed.body.data.appointment.status, "confirmed");

      const completed = await api(`/appointments/${appointmentId}/complete`, {
        method: "PATCH",
        token: verifiedDoctor.token,
        body: { doctorNotes: "Patient responding well to iron therapy." },
      });
      assert.equal(completed.status, 200);
      assert.equal(completed.body.data.appointment.status, "completed");
    });

    it("refuses to cancel a completed appointment", async () => {
      const response = await api(`/appointments/${appointmentId}/cancel`, {
        method: "PATCH",
        token: patient.token,
        body: { reason: "Changed my mind" },
      });

      assert.equal(response.status, 400);
    });

    it("hides a third party's appointment", async () => {
      const response = await api(`/appointments/${appointmentId}`, {
        token: otherPatient.token,
      });

      assert.equal(response.status, 403);
    });
  });
});
