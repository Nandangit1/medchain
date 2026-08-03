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
 * BUILD (needs the circom compiler, a Rust binary, plus a powers-of-tau file):
 *
 *   circom circuits/range_proof.circom --r1cs --wasm --sym -o build/
 *   snarkjs groth16 setup build/range_proof.r1cs pot14_final.ptau build/rp_0000.zkey
 *   snarkjs zkey contribute build/rp_0000.zkey build/rp_final.zkey
 *   snarkjs zkey export verificationkey build/rp_final.zkey build/verification_key.json
 *   snarkjs zkey export solidityverifier build/rp_final.zkey contracts/RangeVerifier.sol
 *
 * Deploying RangeVerifier.sol then makes the proof checkable ON CHAIN, so a
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
