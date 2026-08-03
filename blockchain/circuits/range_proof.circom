pragma circom 2.1.6;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/comparators.circom";

/*
 * Proves: "I know a value v and a salt s such that Poseidon(v, s) == commitment
 *          AND v < threshold"
 * without revealing v or s.
 *
 * This is the circuit behind MedChain's selective disclosure. A patient proves
 * to an insurer that their HbA1c is under 7 without handing over the lab
 * report, or that they are over 18 without disclosing a birth date.
 *
 * SIGNALS
 *   private  value      the committed measurement, scaled by 1000 so the
 *                       circuit works over integers (6.4 -> 6400)
 *   private  salt       blinding factor; without it the verifier could brute
 *                       force a small value range against the commitment
 *   public   commitment Poseidon(value, salt), published or anchored on-chain
 *   public   threshold  the bound being proven, also scaled by 1000
 *
 * The commitment is public precisely so the verifier can check it against the
 * one the patient published earlier. That binding is what stops a patient
 * proving a statement about a value they invented after being asked.
 *
 * BUILD
 *
 *   npm run zk:build
 *
 * That compiles this file, runs the Groth16 setup, and writes both the
 * verification key and contracts/RangeVerifier.sol. It needs the circom
 * compiler in .tools/ -- a standalone Rust binary, deliberately not committed.
 * The API loads the resulting proving key on start and needs no restart-time
 * configuration.
 *
 * SIZE: ~715 constraints. A proof takes roughly 0.8s to produce and 25ms to
 * verify, and is about 720 bytes.
 *
 * The exported RangeVerifier.sol makes a proof checkable ON CHAIN, so a
 * verifier need not trust MedChain at all -- which is the whole point.
 */
template RangeProof(nBits) {
    signal input value;
    signal input salt;
    signal input commitment;
    signal input threshold;

    // 1. The value must be the one that was committed to.
    component hasher = Poseidon(2);
    hasher.inputs[0] <== value;
    hasher.inputs[1] <== salt;
    hasher.out === commitment;

    // 2. The value must satisfy the bound.
    //
    // LessThan is only sound for inputs that fit in nBits, so both sides are
    // range-checked first. Without this an attacker can pick a value that
    // wraps the field modulus and prove anything at all -- the classic
    // under-constrained-circuit bug.
    component valueBits = Num2Bits(nBits);
    valueBits.in <== value;

    component thresholdBits = Num2Bits(nBits);
    thresholdBits.in <== threshold;

    component lt = LessThan(nBits);
    lt.in[0] <== value;
    lt.in[1] <== threshold;
    lt.out === 1;
}

// 64 bits covers every clinical measurement scaled by 1000, with room to spare.
component main {public [commitment, threshold]} = RangeProof(64);
