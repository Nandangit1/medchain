const { ALLOWED_MIME_TYPES, BLOCKCHAIN_SYNC_STATUS, RECORD_STATUS } = require("../constants/records");
const { DOCTOR_VERIFICATION_STATUS, ROLES } = require("../constants/roles");
const medicalRecordRepository = require("../repositories/medicalRecordRepository");
const userRepository = require("../repositories/userRepository");
const AppError = require("../utils/AppError");
const { buildPagination, buildPaginationMeta } = require("../utils/pagination");
const { hashesMatch, sha256Hex } = require("../utils/hash");
const { AUDIT_ACTIONS } = require("../constants/audit");
const { NOTIFICATION_TYPES } = require("../models/Notification");
const accessControlService = require("./accessControlService");
const auditService = require("./auditService");
const blockchainService = require("./blockchainService");
const encryptionService = require("./encryptionService");
const notificationService = require("./notificationService");
const ipfsService = require("./ipfs");

/**
 * Medical Record Service.
 *
 * Owns the entire upload/retrieval workflow and every authorization rule that
 * governs clinical data. Controllers below stay thin (HTTP in, HTTP out) and
 * the repository above stays dumb (persistence only), which is what keeps the
 * business rules in exactly one auditable place.
 *
 * Authorization model as of Module 3:
 *
 *   Patient  full control over their OWN records, including plaintext download
 *   Admin    metadata and integrity verification only — never plaintext
 *   Doctor   no access yet; granted per-record by the patient in Module 5,
 *            enforced on-chain by the access-control contract
 *
 * Admins are deliberately denied plaintext. An administrator needs to operate
 * the platform, not to read a patient's pathology report, and encoding that
 * distinction here is what makes "the patient owns their data" a property of
 * the system rather than a claim in the report.
 */

/** Works whether `patient` is a raw ObjectId or a populated document. */
const ownerIdOf = (record) => String(record.patient?._id ?? record.patient);

const isOwner = (actor, record) => ownerIdOf(record) === String(actor._id);

const assertCanViewMetadata = async (actor, record) => {
  if (await canViewMetadata(actor, record)) {
    return;
  }

  throw new AppError("You do not have permission to access this medical record.", 403);
};

/**
 * Async since Module 5: a doctor's entitlement depends on a live access grant,
 * which is checked against MongoDB and then against the chain.
 */
const assertCanReadContent = async (actor, record) => {
  if (isOwner(actor, record)) {
    return;
  }

  if (actor.role === ROLES.ADMIN) {
    throw new AppError(
      "Administrators may review record metadata and integrity, but not the clinical file itself.",
      403
    );
  }

  if (actor.role === ROLES.DOCTOR) {
    if (actor.doctorProfile?.verificationStatus !== DOCTOR_VERIFICATION_STATUS.VERIFIED) {
      throw new AppError("Your account must be verified by an administrator first.", 403);
    }

    if (await accessControlService.doctorCanRead(actor, record)) {
      return;
    }

    throw new AppError(
      "The patient has not granted you access to this record, or the grant has expired.",
      403
    );
  }

  throw new AppError("You do not have permission to access this medical record.", 403);
};

const canViewMetadata = async (actor, record) => {
  if (actor.role === ROLES.ADMIN || isOwner(actor, record)) {
    return true;
  }

  if (actor.role === ROLES.DOCTOR) {
    return accessControlService.doctorCanRead(actor, record);
  }

  return false;
};

const assertCanModify = (actor, record) => {
  if (!isOwner(actor, record)) {
    throw new AppError("Only the owning patient can modify this medical record.", 403);
  }
};

const normalizeTags = (tags) => {
  if (!tags) {
    return [];
  }

  const list = Array.isArray(tags) ? tags : String(tags).split(",");

  return [
    ...new Set(
      list
        .map((tag) => String(tag).trim().toLowerCase())
        .filter((tag) => tag.length > 0 && tag.length <= 30)
    ),
  ].slice(0, 10);
};

const buildListFilter = async (actor, query) => {
  const filter = {};

  // A patient is hard-scoped to their own data regardless of what they send.
  if (actor.role === ROLES.PATIENT) {
    filter.patient = actor._id;
  } else if (actor.role === ROLES.DOCTOR) {
    /**
     * A doctor sees exactly the records currently shared with them — never a
     * whole patient. Resolving the id list up front means the scope cannot be
     * widened by a crafted query parameter.
     */
    filter._id = { $in: await accessControlService.listLiveRecordIdsForDoctor(actor._id) };

    if (query.patientId) {
      filter.patient = query.patientId;
    }
  } else if (query.patientId) {
    filter.patient = query.patientId;
  }

  if (query.recordType) {
    filter.recordType = query.recordType;
  }

  if (query.status) {
    filter.status = query.status;
  }

  if (query.blockchainStatus) {
    filter["blockchain.status"] = query.blockchainStatus;
  }

  if (query.from || query.to) {
    filter.recordDate = {};
    if (query.from) {
      filter.recordDate.$gte = new Date(query.from);
    }
    if (query.to) {
      filter.recordDate.$lte = new Date(query.to);
    }
  }

  if (query.search) {
    const searchRegex = new RegExp(query.search.trim(), "i");
    filter.$or = [{ title: searchRegex }, { description: searchRegex }, { tags: searchRegex }];
  }

  return filter;
};

/**
 * Uploads a new medical record.
 *
 * Pipeline: hash plaintext -> reject duplicates -> encrypt -> pin ciphertext
 * to IPFS -> persist metadata. The digest is taken over the plaintext before
 * encryption so it remains a stable identity for the document itself, which
 * is the value Module 4 anchors on-chain.
 */
const createRecord = async ({ actor, patient, file, payload }) => {
  if (!file) {
    throw new AppError("A medical report file is required.", 400);
  }

  const fileHash = sha256Hex(file.buffer);

  const duplicate = await medicalRecordRepository.existsByPatientAndHash(patient._id, fileHash);
  if (duplicate) {
    throw new AppError("This exact file has already been uploaded to your records.", 409);
  }

  const { ciphertext, envelope } = encryptionService.encryptBuffer(file.buffer);

  const stored = await ipfsService.upload(ciphertext, {
    fileName: `${fileHash.slice(0, 16)}.enc`,
    metadata: {
      patientId: String(patient._id),
      recordType: payload.recordType,
    },
  });

  try {
    const record = await medicalRecordRepository.create({
      patient: patient._id,
      uploadedBy: actor._id,
      uploadedByRole: actor.role,
      title: payload.title,
      description: payload.description,
      recordType: payload.recordType,
      recordDate: payload.recordDate || new Date(),
      tags: normalizeTags(payload.tags),
      file: {
        originalName: file.originalname,
        mimeType: file.mimetype,
        extension: ALLOWED_MIME_TYPES[file.mimetype],
        size: file.size,
      },
      storage: {
        provider: stored.provider,
        cid: stored.cid,
        gatewayUrl: stored.gatewayUrl,
        encryptedSize: stored.size,
      },
      integrity: {
        algorithm: "sha256",
        fileHash,
      },
      encryption: envelope,
      blockchain: {
        status: BLOCKCHAIN_SYNC_STATUS.PENDING,
      },
      status: RECORD_STATUS.ACTIVE,
    });

    /**
     * Anchoring happens AFTER the record is safely persisted, and
     * `anchorRecord` never throws. If the chain is unreachable the record
     * simply stays "pending" and `scripts/backfillAnchors.js` re-drives it
     * later — an upload is never lost to a blockchain problem.
     */
    const anchor = await blockchainService.anchorRecord({ patient, record });

    if (anchor.status !== BLOCKCHAIN_SYNC_STATUS.PENDING) {
      record.blockchain = anchor;
      await record.save({ validateBeforeSave: false });
    }

    return record;
  } catch (error) {
    /**
     * Compensating action: the pin succeeded but the metadata write did not.
     * Without this, a failed upload would leave an orphaned encrypted blob
     * that nothing in the system can ever reference or clean up.
     */
    await ipfsService.unpin(stored.cid).catch(() => false);
    throw error;
  }
};

/** Patient uploading one of their own documents. */
const uploadRecord = async ({ actor, file, payload, req }) => {
  const patient = await userRepository.findActivePatientById(actor._id);

  if (!patient) {
    throw new AppError("Only an active patient account can upload medical records.", 403);
  }

  const record = await createRecord({ actor, patient, file, payload });

  await auditService.record({
    action: AUDIT_ACTIONS.RECORD_UPLOADED,
    actor,
    targetRecord: record,
    description: `Uploaded "${record.title}"`,
    metadata: { cid: record.storage.cid, anchor: record.blockchain?.status },
    req,
  });

  return record.toClientObject();
};

/**
 * Verified doctor uploading a prescription or report FOR a patient.
 *
 * Gated on an existing share: a doctor may only write into the chart of a
 * patient who has already granted them access to something. Without that rule
 * any verified doctor could push documents into any patient's record.
 */
const uploadRecordForPatient = async ({ actor, patientId, file, payload, req }) => {
  if (actor.doctorProfile?.verificationStatus !== DOCTOR_VERIFICATION_STATUS.VERIFIED) {
    throw new AppError("Your account must be verified by an administrator first.", 403);
  }

  const patient = await userRepository.findActivePatientById(patientId);

  if (!patient) {
    throw new AppError("Patient not found.", 404);
  }

  const sharedRecordIds = await accessControlService.listLiveRecordIdsForDoctor(actor._id);
  const patientRecords = await medicalRecordRepository.findManyPaginated(
    { _id: { $in: sharedRecordIds }, patient: patient._id },
    { skip: 0, limit: 1 }
  );

  if (patientRecords.totalItems === 0) {
    throw new AppError(
      "You can only add documents for a patient who has shared at least one record with you.",
      403
    );
  }

  const record = await createRecord({ actor, patient, file, payload });

  /**
   * The uploading doctor keeps read access to what they just wrote, otherwise
   * they could not open their own prescription.
   */
  await accessControlService.grantSystemAccess({ record, patient, doctor: actor });

  await auditService.record({
    action: AUDIT_ACTIONS.PRESCRIPTION_UPLOADED,
    actor,
    targetUser: patient,
    targetRecord: record,
    description: `Uploaded "${record.title}" into ${patient.name}'s chart`,
    req,
  });

  await notificationService.push({
    user: patient._id,
    type: NOTIFICATION_TYPES.PRESCRIPTION_ADDED,
    title: "A doctor added a document to your records",
    message: `${actor.name} uploaded "${record.title}".`,
    link: `/patient/records/${record._id}`,
  });

  return record.toClientObject();
};

const listRecords = async ({ actor, query }) => {
  const pagination = buildPagination(query);
  const filter = await buildListFilter(actor, query);

  const { records, totalItems } = await medicalRecordRepository.findManyPaginated(filter, pagination);

  return {
    records: records.map((record) => record.toClientObject()),
    pagination: buildPaginationMeta(totalItems, pagination),
  };
};

const getRecordById = async ({ actor, recordId }) => {
  const record = await medicalRecordRepository.findById(recordId);

  if (!record) {
    throw new AppError("Medical record not found.", 404);
  }

  await assertCanViewMetadata(actor, record);

  return record.toClientObject();
};

/**
 * Retrieves the record and returns decrypted plaintext.
 *
 * Integrity is re-verified on every read: the digest of the decrypted bytes
 * must equal the digest captured at upload. GCM already proves the ciphertext
 * was not altered, but this second check also catches a storage layer that
 * silently returned the wrong object, and it is the same comparison the smart
 * contract will perform against the on-chain hash from Module 4 onward.
 */
const downloadRecord = async ({ actor, recordId, req }) => {
  const record = await medicalRecordRepository.findByIdWithSecrets(recordId);

  if (!record) {
    throw new AppError("Medical record not found.", 404);
  }

  await assertCanReadContent(actor, record);

  const ciphertext = await ipfsService.fetchByCid(record.storage.cid);
  const plaintext = encryptionService.decryptBuffer(ciphertext, record.encryption);

  if (!hashesMatch(record.integrity.fileHash, sha256Hex(plaintext))) {
    throw new AppError(
      "Integrity check failed: the retrieved file does not match its recorded hash. Download blocked.",
      422
    );
  }

  /**
   * A doctor reading a patient's file is exactly the event an audit trail
   * exists to capture. Written on-chain, and never allowed to fail the read:
   * the clinician already holds the bytes by this point.
   */
  if (actor.role === ROLES.DOCTOR) {
    blockchainService.logAccessOnChain({ record, viewer: actor }).catch(() => null);

    await notificationService.push({
      user: record.patient?._id ?? record.patient,
      type: NOTIFICATION_TYPES.RECORD_VIEWED,
      title: "A doctor opened one of your records",
      message: `${actor.name} viewed "${record.title}".`,
      link: `/patient/records/${record._id}`,
    });
  }

  await auditService.record({
    action: AUDIT_ACTIONS.RECORD_DOWNLOADED,
    actor,
    targetRecord: record,
    targetUser: record.patient?._id ?? record.patient,
    description: `Decrypted and downloaded "${record.title}"`,
    req,
  });

  return { buffer: plaintext, record };
};

/**
 * Non-destructive integrity audit. Returns a verdict instead of the file, so
 * it can be exposed to auditors without exposing clinical content.
 */
const verifyRecordIntegrity = async ({ actor, recordId }) => {
  const record = await medicalRecordRepository.findByIdWithSecrets(recordId);

  if (!record) {
    throw new AppError("Medical record not found.", 404);
  }

  await assertCanViewMetadata(actor, record);

  /**
   * The on-chain check is INDEPENDENT of MongoDB: it asks the contract whether
   * the anchored hash matches, so a database that had been tampered with
   * cannot vouch for itself.
   */
  const onChain = await blockchainService.verifyOnChain(
    record.blockchain?.onChainId,
    record.integrity.fileHash
  );

  const report = {
    recordId: String(record._id),
    cid: record.storage.cid,
    provider: record.storage.provider,
    algorithm: record.integrity.algorithm,
    expectedHash: record.integrity.fileHash,
    blockchain: {
      status: record.blockchain?.status,
      onChainId: record.blockchain?.onChainId || null,
      txHash: record.blockchain?.txHash || null,
      anchored: Boolean(record.blockchain?.onChainId),
      hashMatchesChain: onChain.matches,
      chainReachable: onChain.available,
    },
    verifiedAt: new Date(),
  };

  try {
    const ciphertext = await ipfsService.fetchByCid(record.storage.cid);
    const plaintext = encryptionService.decryptBuffer(ciphertext, record.encryption);
    const actualHash = sha256Hex(plaintext);

    return {
      ...report,
      actualHash,
      retrievable: true,
      authentic: true,
      integrityVerified: hashesMatch(record.integrity.fileHash, actualHash),
    };
  } catch (error) {
    return {
      ...report,
      actualHash: null,
      retrievable: error.statusCode !== 404,
      authentic: error.statusCode !== 422,
      integrityVerified: false,
      reason: error.message,
    };
  }
};

/**
 * Only descriptive metadata is mutable. The file, its hash, its CID and its
 * encryption envelope are immutable by design — changing a stored document
 * means uploading a new record, which is what preserves the audit trail.
 */
const updateRecordMetadata = async ({ actor, recordId, payload }) => {
  const record = await medicalRecordRepository.findById(recordId);

  if (!record) {
    throw new AppError("Medical record not found.", 404);
  }

  assertCanModify(actor, record);

  const allowedFields = ["title", "description", "recordType", "recordDate", "status"];
  const updates = {};

  allowedFields.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(payload, field)) {
      updates[field] = payload[field];
    }
  });

  if (Object.prototype.hasOwnProperty.call(payload, "tags")) {
    updates.tags = normalizeTags(payload.tags);
  }

  if (Object.keys(updates).length === 0) {
    throw new AppError("No updatable fields were provided.", 400);
  }

  const updated = await medicalRecordRepository.updateById(recordId, updates);

  return updated.toClientObject();
};

/**
 * Soft delete. The metadata row and its blockchain anchor are retained so the
 * audit trail stays complete; only the encrypted blob is unpinned, which makes
 * the content unrecoverable without destroying the evidence that it existed.
 */
const deleteRecord = async ({ actor, recordId }) => {
  const record = await medicalRecordRepository.findById(recordId);

  if (!record) {
    throw new AppError("Medical record not found.", 404);
  }

  assertCanModify(actor, record);

  const deleted = await medicalRecordRepository.softDeleteById(recordId, actor._id);
  const unpinned = await ipfsService.unpin(record.storage.cid).catch(() => false);

  return {
    recordId: String(deleted._id),
    unpinnedFromIpfs: unpinned,
  };
};

module.exports = {
  deleteRecord,
  downloadRecord,
  getRecordById,
  listRecords,
  updateRecordMetadata,
  uploadRecord,
  uploadRecordForPatient,
  verifyRecordIntegrity,
};
