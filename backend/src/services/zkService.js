const crypto = require("crypto");

const { buildPoseidon } = require("circomlibjs");

const AppError = require("../utils/AppError");

/**
 * Zero-knowledge commitment layer.
 *
 * A patient can hold a structured claim -- "HbA1c = 6.4" -- and later prove
 * something about it to an insurer or an employer without handing over the
 * report it came from.
 *
 * WHY POSEIDON AND NOT SHA-256
 *
 * The record's integrity hash stays SHA-256: it is the fingerprint of the file
 * and nothing about that changes. But SHA-256 is brutally expensive to prove
 * things about inside an arithmetic circuit -- tens of thousands of
 * constraints for one hash. Poseidon is designed for exactly this and costs a
 * few hundred. So there are deliberately two hashes over the same data, each
 * doing the job it is good at:
 *
 *   SHA-256   "this file is byte-identical to the one anchored"    (integrity)
 *   Poseidon  "this value is the one committed to, and X about it" (proving)
 *
 * WHAT IS AND IS NOT ZERO-KNOWLEDGE HERE
 *
 * `commit` and `verifyDisclosure` below are a binding commitment scheme: the
 * patient cannot change the value after the fact, and the verifier learns
 * nothing about attributes that were not disclosed. That much works today and
 * is what the API exposes.
 *
 * Proving a PREDICATE without revealing the value -- "my HbA1c is under 7"
 * while keeping 6.4 secret -- needs a SNARK over this commitment. The circuit
 * is written and lives in blockchain/circuits/range_proof.circom; compiling it
 * requires the circom compiler, which is a separate Rust binary. Until that is
 * run, disclosure reveals the value it discloses, and this file says so rather
 * than implying otherwise.
 */

let poseidonPromise = null;

/** Built once: the WASM instance is expensive to construct and stateless. */
const getPoseidon = () => {
  if (!poseidonPromise) {
    poseidonPromise = buildPoseidon();
  }

  return poseidonPromise;
};

/**
 * Values are committed as field elements. A decimal like 6.4 is scaled by
 * SCALE and rounded, so 6.4 becomes 6400 -- circuits work over integers, and
 * a float would not be reproducible across languages.
 */
const SCALE = 1000n;

const toFieldElement = (value) => {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    throw new AppError("A committed value must be a number.", 400);
  }

  if (numeric < 0) {
    throw new AppError("Negative values cannot be committed.", 400);
  }

  return BigInt(Math.round(numeric * Number(SCALE)));
};

const fromFieldElement = (element) => Number(BigInt(element)) / Number(SCALE);

/**
 * Poseidon(value, salt).
 *
 * The salt is what stops a verifier brute-forcing the value: without it,
 * "is the commitment Poseidon(5.0)? Poseidon(5.1)?" recovers any value from a
 * small range in milliseconds.
 */
const commit = async ({ value, salt }) => {
  const poseidon = await getPoseidon();
  const saltValue = salt ? BigInt(salt) : BigInt(`0x${crypto.randomBytes(31).toString("hex")}`);

  const digest = poseidon([toFieldElement(value), saltValue]);

  return {
    commitment: poseidon.F.toString(digest),
    salt: saltValue.toString(),
  };
};

/**
 * Recomputes the commitment from a disclosed (value, salt) pair.
 *
 * This is the verifier's side, and it needs no access to MedChain: given the
 * commitment -- which can be published or anchored -- anyone can run this and
 * decide for themselves. That is the property that makes the claim meaningful.
 */
const verifyDisclosure = async ({ value, salt, commitment }) => {
  try {
    const recomputed = await commit({ value, salt });
    // Plain comparison is fine: both sides are public by the time this runs.
    return recomputed.commitment === String(commitment);
  } catch {
    return false;
  }
};

/**
 * Evaluates a predicate against a disclosed value.
 *
 * Today this runs AFTER disclosure, so it is a convenience for the verifier
 * rather than a privacy property. Once the circuit is compiled the same
 * predicate is what the SNARK proves, and the value stops being sent at all --
 * the shape of this function is deliberately the shape the circuit takes, so
 * swapping one for the other does not change the API.
 */
const PREDICATES = Object.freeze({
  LESS_THAN: "lt",
  LESS_OR_EQUAL: "lte",
  GREATER_THAN: "gt",
  GREATER_OR_EQUAL: "gte",
  EQUAL: "eq",
});

const evaluatePredicate = ({ value, predicate, threshold }) => {
  const left = toFieldElement(value);
  const right = toFieldElement(threshold);

  switch (predicate) {
    case PREDICATES.LESS_THAN:
      return left < right;
    case PREDICATES.LESS_OR_EQUAL:
      return left <= right;
    case PREDICATES.GREATER_THAN:
      return left > right;
    case PREDICATES.GREATER_OR_EQUAL:
      return left >= right;
    case PREDICATES.EQUAL:
      return left === right;
    default:
      throw new AppError(`Unknown predicate "${predicate}".`, 400);
  }
};

const describePredicate = ({ attribute, predicate, threshold, unit }) => {
  const words = {
    [PREDICATES.LESS_THAN]: "is below",
    [PREDICATES.LESS_OR_EQUAL]: "is at most",
    [PREDICATES.GREATER_THAN]: "is above",
    [PREDICATES.GREATER_OR_EQUAL]: "is at least",
    [PREDICATES.EQUAL]: "equals",
  };

  return `${attribute} ${words[predicate]} ${threshold}${unit ? ` ${unit}` : ""}`;
};

module.exports = {
  PREDICATES,
  SCALE,
  commit,
  describePredicate,
  evaluatePredicate,
  fromFieldElement,
  toFieldElement,
  verifyDisclosure,
};
