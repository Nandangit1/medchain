const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { after, before, describe, it } = require("node:test");

/**
 * Module 3 integration tests — medical records, encryption and IPFS storage.
 *
 * These are true black-box API tests: they drive the running server over HTTP
 * exactly as the React frontend will. Start the stack first, then run:
 *
 *   npm run test:integration
 *
 * Requires MongoDB and the API to be running (npm run dev).
 */
const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:5000/api/v1";
const PASSWORD = "Str0ng!Passw0rd";

/** Unique per run so repeated executions never collide on the unique email index. */
const runId = crypto.randomBytes(6).toString("hex");

const api = async (endpoint, { method = "GET", token, body, raw = false } = {}) => {
  const headers = {};

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let payload = body;

  if (body && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  const response = await fetch(`${BASE_URL}${endpoint}`, { method, headers, body: payload });

  return {
    status: response.status,
    body: raw ? Buffer.from(await response.arrayBuffer()) : await response.json().catch(() => null),
    headers: response.headers,
  };
};

const registerPatient = async (label) => {
  const email = `${label}.${runId}@example.com`;

  const response = await api("/auth/register", {
    method: "POST",
    body: {
      name: `Test ${label}`,
      email,
      password: PASSWORD,
      role: "patient",
    },
  });

  assert.equal(response.status, 201, `Registration failed: ${JSON.stringify(response.body)}`);

  return { email, token: response.body.data.token, user: response.body.data.user };
};

/** A small but structurally valid PDF, so the MIME allow-list is genuinely exercised. */
const buildPdf = (marker) =>
  Buffer.from(
    `%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n% ${marker}\n%%EOF\n`,
    "utf8"
  );

const uploadRecord = async (token, buffer, fields = {}) => {
  const form = new FormData();

  form.append("file", new Blob([buffer], { type: "application/pdf" }), "report.pdf");
  form.append("title", fields.title || "Complete Blood Count");
  form.append("recordType", fields.recordType || "lab_report");

  if (fields.description) {
    form.append("description", fields.description);
  }
  if (fields.tags) {
    form.append("tags", fields.tags);
  }

  return api("/records", { method: "POST", token, body: form });
};

describe("Module 3 — Medical Records", () => {
  let patient;
  let otherPatient;
  let admin;
  let recordId;
  let storedCid;
  const plaintext = buildPdf(`primary-${runId}`);

  before(async () => {
    patient = await registerPatient("patient.one");
    otherPatient = await registerPatient("patient.two");

    // The admin account comes from the Module 1 seed script.
    const adminLogin = await api("/auth/login", {
      method: "POST",
      body: {
        email: process.env.ADMIN_EMAIL || "admin@example.com",
        password: process.env.ADMIN_PASSWORD || "Admin@12345",
      },
    });

    admin = adminLogin.status === 200 ? { token: adminLogin.body.data.token } : null;
  });

  it("rejects an unauthenticated upload", async () => {
    const response = await uploadRecord(undefined, plaintext);
    assert.equal(response.status, 401);
  });

  it("rejects a disallowed file type", async () => {
    const form = new FormData();
    form.append("file", new Blob([Buffer.from("MZ\x90\x00")], { type: "application/x-msdownload" }), "evil.exe");
    form.append("title", "Malicious upload attempt");
    form.append("recordType", "other");

    const response = await api("/records", { method: "POST", token: patient.token, body: form });

    assert.equal(response.status, 415);
  });

  it("rejects an upload that is missing required metadata", async () => {
    const form = new FormData();
    form.append("file", new Blob([plaintext], { type: "application/pdf" }), "report.pdf");
    form.append("title", "ab"); // shorter than the 3-character minimum

    const response = await api("/records", { method: "POST", token: patient.token, body: form });

    assert.equal(response.status, 400);
  });

  it("uploads, encrypts and pins a medical record", async () => {
    const response = await uploadRecord(patient.token, plaintext, {
      description: "Routine annual blood panel.",
      tags: "blood,routine,2026",
    });

    assert.equal(response.status, 201, JSON.stringify(response.body));

    const record = response.body.data.record;
    recordId = record._id;
    storedCid = record.storage.cid;

    assert.ok(record.storage.cid, "a CID must be recorded");
    assert.equal(record.integrity.algorithm, "sha256");
    assert.equal(
      record.integrity.fileHash,
      crypto.createHash("sha256").update(plaintext).digest("hex"),
      "the stored hash must be the digest of the PLAINTEXT"
    );
    // With BLOCKCHAIN_ENABLED=false the record legitimately stays "pending".
    // "failed" is never acceptable — that means anchoring was attempted and broke.
    assert.ok(
      ["confirmed", "pending"].includes(record.blockchain.status),
      `unexpected anchor status "${record.blockchain.status}": ${record.blockchain.lastError || ""}`
    );

    if (record.blockchain.status === "confirmed") {
      assert.ok(record.blockchain.onChainId, "a confirmed anchor must carry its on-chain id");
      assert.match(record.blockchain.txHash, /^0x[0-9a-f]{64}$/);
    }
    assert.deepEqual(record.tags, ["blood", "routine", "2026"]);

    // The API must never expose key material.
    assert.equal(record.encryption, undefined, "encryption envelope must never leave the server");
  });

  it("stores ciphertext, not plaintext, at rest", async (t) => {
    if ((process.env.IPFS_DRIVER || "local") !== "local") {
      return t.skip("on-disk assertion only applies to the local driver");
    }

    const root = path.resolve(process.cwd(), process.env.LOCAL_IPFS_PATH || "./.local/ipfs");
    const blob = await fs.readFile(path.join(root, storedCid.slice(1, 3), storedCid));

    assert.ok(
      !blob.includes(Buffer.from("%PDF")),
      "the stored blob must not contain recognisable plaintext"
    );
    assert.notEqual(blob.toString("hex"), plaintext.toString("hex"));
  });

  it("rejects a byte-identical duplicate upload", async () => {
    const response = await uploadRecord(patient.token, plaintext);
    assert.equal(response.status, 409);
  });

  it("lists only the owner's records", async () => {
    const mine = await api("/records", { token: patient.token });
    assert.equal(mine.status, 200);
    assert.ok(mine.body.data.records.length >= 1);

    const theirs = await api("/records", { token: otherPatient.token });
    assert.equal(theirs.status, 200);
    assert.equal(theirs.body.data.records.length, 0, "a patient must not see another patient's records");
  });

  it("scopes a patient to their own data even when they forge a patientId filter", async () => {
    const response = await api(`/records?patientId=${patient.user._id}`, {
      token: otherPatient.token,
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.data.records.length, 0);
  });

  it("downloads and returns byte-identical plaintext", async () => {
    const response = await api(`/records/${recordId}/download`, {
      token: patient.token,
      raw: true,
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/pdf");
    assert.equal(
      response.body.toString("hex"),
      plaintext.toString("hex"),
      "the round-tripped file must be byte-identical to what was uploaded"
    );
  });

  it("denies a different patient access to the record", async () => {
    const metadata = await api(`/records/${recordId}`, { token: otherPatient.token });
    assert.equal(metadata.status, 403);

    const download = await api(`/records/${recordId}/download`, { token: otherPatient.token });
    assert.equal(download.status, 403);
  });

  it("lets an admin read metadata but never the clinical file", async (t) => {
    if (!admin) {
      return t.skip("admin account not seeded; run npm run seed:admin");
    }

    const metadata = await api(`/records/${recordId}`, { token: admin.token });
    assert.equal(metadata.status, 200);

    const download = await api(`/records/${recordId}/download`, { token: admin.token });
    assert.equal(download.status, 403, "administrators must not be able to read patient files");
  });

  it("verifies integrity of an untampered record", async () => {
    const response = await api(`/records/${recordId}/verify`, { token: patient.token });

    assert.equal(response.status, 200);
    assert.equal(response.body.data.report.integrityVerified, true);
    assert.equal(response.body.data.report.expectedHash, response.body.data.report.actualHash);
  });

  /**
   * The on-chain check is independent of MongoDB: the contract is asked
   * whether the anchored hash matches, so a tampered database cannot vouch
   * for itself.
   */
  it("confirms the hash against the blockchain", async (t) => {
    const health = await api("/health");
    if (!health.body?.data?.blockchain?.connected) {
      return t.skip("blockchain not enabled");
    }

    const response = await api(`/records/${recordId}/verify`, { token: patient.token });
    const { blockchain } = response.body.data.report;

    assert.equal(blockchain.anchored, true, "record should be anchored");
    assert.equal(blockchain.status, "confirmed");
    assert.equal(blockchain.chainReachable, true);
    assert.equal(blockchain.hashMatchesChain, true, "stored hash must match the anchored hash");
    assert.ok(blockchain.onChainId);
  });

  /**
   * Regression test for a nonce collision.
   *
   * Every anchor is signed by one registrar key, and Ethereum orders a
   * sender's transactions by a strictly incrementing nonce. Concurrent
   * uploads used to read the same pending nonce and the later transaction was
   * rejected with "nonce has already been used", silently downgrading the
   * record to blockchain.status "failed". Submissions are now serialised
   * behind a queue with an in-process nonce counter.
   */
  it("anchors concurrent uploads without a nonce collision", async (t) => {
    const health = await api("/health");
    if (!health.body?.data?.blockchain?.connected) {
      return t.skip("blockchain not enabled; nothing to serialise");
    }

    const uploads = await Promise.all(
      [1, 2, 3, 4].map((n) =>
        uploadRecord(patient.token, buildPdf(`concurrent-${n}-${runId}`), {
          title: `Concurrent upload ${n}`,
        })
      )
    );

    uploads.forEach((response, index) => {
      assert.equal(response.status, 201, `upload ${index + 1} failed`);
      assert.equal(
        response.body.data.record.blockchain.status,
        "confirmed",
        `upload ${index + 1} did not anchor: ${response.body.data.record.blockchain.lastError || ""}`
      );
    });

    // Every concurrent upload must land on its own distinct on-chain id.
    const ids = uploads.map((r) => r.body.data.record.blockchain.onChainId);
    assert.equal(new Set(ids).size, ids.length, `on-chain ids collided: ${ids.join(", ")}`);
  });

  it("updates only mutable metadata", async () => {
    const response = await api(`/records/${recordId}`, {
      method: "PATCH",
      token: patient.token,
      body: { title: "Complete Blood Count (revised)", status: "archived" },
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.data.record.title, "Complete Blood Count (revised)");
    assert.equal(response.body.data.record.status, "archived");
    assert.equal(response.body.data.record.storage.cid, storedCid, "the CID is immutable");
  });

  it("detects tampering with the stored ciphertext", async (t) => {
    if ((process.env.IPFS_DRIVER || "local") !== "local") {
      return t.skip("tamper injection only applies to the local driver");
    }

    // Upload a dedicated record so the tampering does not affect other tests.
    const victim = buildPdf(`tamper-${runId}`);
    const uploaded = await uploadRecord(patient.token, victim, { title: "Tamper target" });
    assert.equal(uploaded.status, 201);

    const cid = uploaded.body.data.record.storage.cid;
    const root = path.resolve(process.cwd(), process.env.LOCAL_IPFS_PATH || "./.local/ipfs");
    const blobPath = path.join(root, cid.slice(1, 3), cid);

    const original = await fs.readFile(blobPath);
    const corrupted = Buffer.from(original);
    corrupted[Math.floor(corrupted.length / 2)] ^= 0xff; // flip one byte

    await fs.writeFile(blobPath, corrupted);

    const report = await api(`/records/${uploaded.body.data.record._id}/verify`, {
      token: patient.token,
    });

    assert.equal(report.status, 200);
    assert.equal(report.body.data.report.integrityVerified, false, "tampering must be detected");
    assert.equal(report.body.data.report.authentic, false, "GCM must reject the modified ciphertext");

    const download = await api(`/records/${uploaded.body.data.record._id}/download`, {
      token: patient.token,
    });
    assert.equal(download.status, 422, "a tampered file must never be served");

    await fs.writeFile(blobPath, original);
  });

  it("soft deletes a record and hides it from subsequent reads", async () => {
    const uploaded = await uploadRecord(patient.token, buildPdf(`delete-${runId}`), {
      title: "Disposable record",
    });
    assert.equal(uploaded.status, 201);

    const id = uploaded.body.data.record._id;

    const deleted = await api(`/records/${id}`, { method: "DELETE", token: patient.token });
    assert.equal(deleted.status, 200);

    const afterDelete = await api(`/records/${id}`, { token: patient.token });
    assert.equal(afterDelete.status, 404);
  });

  after(async () => {
    // Records are soft-deleted by design; the run-scoped emails keep reruns clean.
  });
});
