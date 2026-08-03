/**
 * Builds the range-proof circuit end to end: compile, trusted setup, and
 * export both the verification key and the Solidity verifier.
 *
 *   npm run zk:build
 *
 * Only `build/range_proof_js/`, `build/rp_final.zkey` and
 * `build/verification_key.json` are kept in git — the server needs those three
 * at runtime. The powers-of-tau files and the r1cs are regenerated here, which
 * is why they are git-ignored.
 *
 * ------------------------------------------------------------------------
 * ON THE TRUSTED SETUP
 *
 * Groth16 needs a setup whose secret randomness ("toxic waste") must be
 * destroyed. If one party knows it, they can forge proofs for statements that
 * are false — which for this circuit means proving a patient's measurement is
 * under a threshold when it is not.
 *
 * This script runs a SINGLE-CONTRIBUTOR setup on one machine. That is correct
 * for development and for a demonstration, and NOT sufficient for real
 * clinical use: there, the phase-2 contribution must come from a multi-party
 * ceremony where at least one participant is honest. Nothing about the circuit
 * or the verifier changes — only where the .zkey comes from.
 * ------------------------------------------------------------------------
 */
const { execFileSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const BUILD = path.join(ROOT, "build");
const TOOLS = path.join(ROOT, ".tools");
const CIRCOM = path.join(TOOLS, os.platform() === "win32" ? "circom.exe" : "circom");

/**
 * 2^12 constraints of headroom against the circuit's ~715. Small enough that
 * the ceremony runs in seconds; raise the exponent if the circuit grows.
 */
const POWER = 12;

const run = (file, args) => {
  process.stdout.write(`  ${path.basename(file)} ${args.slice(0, 3).join(" ")}...\n`);
  execFileSync(file, args, { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
};

const snarkjs = (args) => run(process.execPath, [require.resolve("snarkjs/build/cli.cjs"), ...args]);

const entropy = () => crypto.randomBytes(32).toString("hex");

const main = () => {
  if (!fs.existsSync(CIRCOM)) {
    console.error(
      `\nThe circom compiler is missing.\n\n` +
        `  Download it to ${CIRCOM}\n` +
        `  from https://github.com/iden3/circom/releases/latest\n\n` +
        `It is a standalone Rust binary and is deliberately not committed.\n`
    );
    process.exitCode = 1;
    return;
  }

  fs.mkdirSync(BUILD, { recursive: true });

  console.log("\n1. Compiling the circuit");
  run(CIRCOM, ["circuits/range_proof.circom", "--r1cs", "--wasm", "--sym", "-o", "build/"]);

  console.log("2. Powers of tau (universal, circuit-independent)");
  snarkjs(["powersoftau", "new", "bn128", String(POWER), "build/pot_0000.ptau"]);
  snarkjs([
    "powersoftau", "contribute", "build/pot_0000.ptau", "build/pot_0001.ptau",
    "--name=medchain", `-e=${entropy()}`,
  ]);
  snarkjs(["powersoftau", "prepare", "phase2", "build/pot_0001.ptau", "build/pot_final.ptau"]);

  console.log("3. Groth16 setup (circuit-specific)");
  snarkjs(["groth16", "setup", "build/range_proof.r1cs", "build/pot_final.ptau", "build/rp_0000.zkey"]);
  snarkjs([
    "zkey", "contribute", "build/rp_0000.zkey", "build/rp_final.zkey",
    "--name=medchain", `-e=${entropy()}`,
  ]);

  console.log("4. Exporting keys");
  snarkjs(["zkey", "export", "verificationkey", "build/rp_final.zkey", "build/verification_key.json"]);
  snarkjs(["zkey", "export", "solidityverifier", "build/rp_final.zkey", "contracts/RangeVerifier.sol"]);

  console.log("\nDone. The API picks these up automatically on its next start.");
  console.log("Reminder: this is a single-contributor setup — fine for a demo, not for");
  console.log("real clinical use. See the note at the top of this file.\n");
};

main();
