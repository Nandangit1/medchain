const crypto = require("crypto");

const { AUDIT_ACTIONS } = require("../constants/audit");
const HealthAttribute = require("../models/HealthAttribute");
const auditService = require("../services/auditService");
const zkService = require("../services/zkService");
const AppError = require("../utils/AppError");
const catchAsync = require("../utils/catchAsync");
const { sendSuccess } = require("../utils/sendResponse");

/**
 * Selective disclosure.
 *
 * The patient commits to a measurement once. Later they can hand a verifier --
 * an insurer, an employer, a clinical trial -- a proof about that measurement,
 * without giving them the medical record it came from and without the verifier
 * needing to trust MedChain.
 */

exports.createAttribute = catchAsync(async (req, res) => {
  const { name, value, unit, label, loincCode, recordId, measuredAt } = req.body;

  const { commitment, salt } = await zkService.commit({ value });

  /**
   * Upsert: re-measuring HbA1c replaces the commitment rather than
   * accumulating a history of them. A stale commitment left live would let a
   * patient keep proving a figure that is no longer true.
   */
  const attribute = await HealthAttribute.findOneAndUpdate(
    { patient: req.user._id, name: String(name).toLowerCase() },
    {
      patient: req.user._id,
      name: String(name).toLowerCase(),
      label,
      unit,
      loincCode,
      record: recordId || null,
      value,
      salt,
      commitment,
      measuredAt: measuredAt || new Date(),
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  await auditService.record({
    action: AUDIT_ACTIONS.ATTRIBUTE_COMMITTED,
    actor: req.user,
    description: `Committed to "${name}" (commitment ${commitment.slice(0, 16)}...)`,
    req,
  });

  sendSuccess(res, 201, "Commitment created.", { attribute: attribute.toClientObject() });
});

exports.listAttributes = catchAsync(async (req, res) => {
  const attributes = await HealthAttribute.find({ patient: req.user._id })
    .sort({ createdAt: -1 })
    .exec();

  sendSuccess(res, 200, "Your provable claims.", {
    attributes: attributes.map((attribute) => attribute.toClientObject()),
  });
});

exports.deleteAttribute = catchAsync(async (req, res) => {
  const deleted = await HealthAttribute.findOneAndDelete({
    _id: req.params.attributeId,
    patient: req.user._id,
  }).exec();

  if (!deleted) {
    throw new AppError("Claim not found.", 404);
  }

  sendSuccess(res, 200, "Commitment withdrawn.", null);
});

/**
 * Issues a proof the patient can hand to a verifier.
 *
 * The proof is self-contained: it carries the commitment, the predicate, the
 * opening, and a server signature. A verifier checks it with the public
 * endpoint below, or recomputes Poseidon themselves and trusts nobody.
 *
 * DISCLOSURE, PLAINLY: this reveals the value it proves. The predicate is
 * evaluated so the verifier gets a straight yes/no, but the opening is what
 * binds the answer to the earlier commitment, and an opening contains the
 * value. Hiding it needs the SNARK in blockchain/circuits/range_proof.circom.
 * The response says so in `disclosesValue` rather than leaving a verifier to
 * assume otherwise.
 */
exports.createProof = catchAsync(async (req, res) => {
  const { predicate, threshold, audience, expiresInHours = 24 } = req.body;

  const attribute = await HealthAttribute.findOne({
    _id: req.params.attributeId,
    patient: req.user._id,
  })
    .select("+value +salt")
    .exec();

  if (!attribute) {
    throw new AppError("Claim not found.", 404);
  }

  const holds = zkService.evaluatePredicate({
    value: attribute.value,
    predicate,
    threshold,
  });

  const statement = zkService.describePredicate({
    attribute: attribute.label || attribute.name,
    predicate,
    threshold,
    unit: attribute.unit,
  });

  const zk = zkService.supportsZk(predicate);

  /**
   * A false statement has no zero-knowledge proof -- the circuit will not
   * produce a witness for it. Refusing here is more honest than issuing a
   * "holds: false" proof that reveals the value in the process.
   */
  if (zk && !holds) {
    throw new AppError(
      "That statement is not true of the committed value, so no proof exists for it.",
      422
    );
  }

  const payload = {
    statement,
    holds,
    attribute: attribute.name,
    unit: attribute.unit || null,
    commitment: attribute.commitment,
    predicate,
    threshold,
    audience: audience || null,
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + expiresInHours * 3_600_000).toISOString(),
  };

  if (zk) {
    /**
     * The zero-knowledge path. Note what is absent: there is no opening, so
     * the measured value is not in this payload and cannot be recovered from
     * it. The public signals are only the commitment and the threshold.
     */
    const { proof, publicSignals } = await zkService.generateProof({
      value: attribute.value,
      salt: attribute.salt,
      commitment: attribute.commitment,
      predicate,
      threshold,
    });

    payload.mode = "zero_knowledge";
    payload.zk = { protocol: "groth16", curve: "bn128", proof, publicSignals };
  } else {
    // No circuit for this predicate yet, so the opening is what binds the
    // claim -- and an opening contains the value. Flagged, not hidden.
    payload.mode = "disclosure";
    payload.opening = { value: attribute.value, salt: attribute.salt };
  }

  /**
   * Signed so a verifier can tell the proof came from this deployment and was
   * not assembled by the holder. It is an HMAC rather than a public-key
   * signature because the verification endpoint is the one checking it; moving
   * to Ed25519 would let a verifier check offline, which is the natural next
   * step alongside the SNARK.
   */
  const signature = crypto
    .createHmac("sha256", process.env.JWT_SECRET)
    .update(JSON.stringify(payload))
    .digest("hex");

  await auditService.record({
    action: AUDIT_ACTIONS.PROOF_ISSUED,
    actor: req.user,
    description: `Issued proof: ${statement} (${holds ? "holds" : "does not hold"})${
      audience ? ` for ${audience}` : ""
    }`,
    req,
  });

  sendSuccess(res, 201, "Proof issued.", {
    proof: { ...payload, signature },
    disclosesValue: !zk,
    note: zk
      ? "Zero-knowledge: this proof establishes the statement without revealing the measured value."
      : `No circuit exists for "${predicate}" yet, so this proof reveals the measured value.`,
  });
});

/**
 * Public verification. No authentication on purpose: a proof a verifier can
 * only check by holding a MedChain account is not much of a proof.
 */
exports.verifyProof = catchAsync(async (req, res) => {
  const { proof } = req.body;

  if (!proof?.commitment || !(proof.opening || proof.zk)) {
    throw new AppError("That is not a MedChain proof.", 400);
  }

  const { signature, ...payload } = proof;

  const expected = crypto
    .createHmac("sha256", process.env.JWT_SECRET)
    .update(JSON.stringify(payload))
    .digest("hex");

  // Length-safe compare: a plain === on a signature leaks timing.
  const signatureValid =
    typeof signature === "string" &&
    signature.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"));

  const expired = new Date(proof.expiresAt) < new Date();
  let checks;

  if (proof.zk) {
    /**
     * Zero-knowledge path. Three separate questions, all of which must hold:
     * is the proof cryptographically sound, is it about THIS commitment, and
     * is it about THIS threshold? Checking only the first would accept a valid
     * proof about somebody else's commitment, or about a weaker bound.
     */
    const result = await zkService.verifyProof({
      proof: proof.zk.proof,
      publicSignals: proof.zk.publicSignals,
      commitment: proof.commitment,
      predicate: proof.predicate,
      threshold: proof.threshold,
    });

    checks = {
      signature: signatureValid,
      zeroKnowledgeProof: result.cryptographicallyValid,
      boundToCommitment: result.boundToCommitment,
      boundToThreshold: result.boundToThreshold,
      notExpired: !expired,
    };
  } else {
    const commitmentValid = await zkService.verifyDisclosure({
      value: proof.opening.value,
      salt: proof.opening.salt,
      commitment: proof.commitment,
    });

    checks = {
      // Was it issued by this deployment, unmodified?
      signature: signatureValid,
      // Does the opening actually match the commitment? This is what stops a
      // patient inventing a convenient value after the fact.
      commitmentBinding: commitmentValid,
      // Is the claim true of the committed value?
      predicate: zkService.evaluatePredicate({
        value: proof.opening.value,
        predicate: proof.predicate,
        threshold: proof.threshold,
      }),
      notExpired: !expired,
    };
  }

  sendSuccess(res, 200, "Verification complete.", {
    valid: Object.values(checks).every(Boolean),
    statement: proof.statement,
    mode: proof.zk ? "zero_knowledge" : "disclosure",
    checks,
    commitment: proof.commitment,
    verifiedAt: new Date().toISOString(),
  });
});
