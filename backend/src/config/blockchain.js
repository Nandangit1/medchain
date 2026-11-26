const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const { env } = require("./env");

/**
 * Blockchain connection factory.
 *
 * Resolves the provider, the registrar signer and a contract instance once,
 * lazily, and caches them. `npx hardhat run scripts/deploy.js` writes the
 * address and ABI into `src/config/contracts/TelemedicineRecords.json`, so a
 * fresh deployment wires itself in with no manual copying.
 */
const ARTIFACT_PATH = path.join(__dirname, "contracts", "TelemedicineRecords.json");

let cached = null;

/**
 * Committed ABI-only copy. The deployment file above is git-ignored (it holds
 * a machine-specific address), so a hosted build never has it -- without this
 * fallback a server with BLOCKCHAIN_ENABLED=true could not talk to the
 * contract at all. The address always comes from CONTRACT_ADDRESS anyway.
 */
const COMMITTED_ABI_PATH = path.join(__dirname, "TelemedicineRecords.abi.json");

const loadArtifact = () => {
  const source = [ARTIFACT_PATH, COMMITTED_ABI_PATH].find((candidate) => fs.existsSync(candidate));

  if (!source) {
    throw new Error(
      `Contract ABI not found at ${ARTIFACT_PATH} or ${COMMITTED_ABI_PATH}. ` +
        "Deploy the contract first: cd blockchain && npx hardhat run scripts/deploy.js --network localhost"
    );
  }

  const artifact = JSON.parse(fs.readFileSync(source, "utf8"));

  if (!Array.isArray(artifact.abi) || artifact.abi.length === 0) {
    throw new Error("Contract artifact is missing its ABI. Re-run the deployment script.");
  }

  return artifact;
};

/**
 * @returns {{ provider, signer, contract, artifact, address }}
 */
const getConnection = () => {
  if (cached) {
    return cached;
  }

  if (!env.BLOCKCHAIN_ENABLED) {
    throw new Error("Blockchain support is disabled. Set BLOCKCHAIN_ENABLED=true to use it.");
  }

  const artifact = loadArtifact();

  /**
   * `staticNetwork` stops ethers re-querying chainId on every call, which
   * roughly halves the RPC round-trips per transaction.
   */
  const provider = new ethers.JsonRpcProvider(env.BLOCKCHAIN_RPC_URL, {
    chainId: env.BLOCKCHAIN_CHAIN_ID,
    name: "telemedicine",
  }, { staticNetwork: true });

  const signer = new ethers.Wallet(env.REGISTRAR_PRIVATE_KEY, provider);
  const contract = new ethers.Contract(env.CONTRACT_ADDRESS, artifact.abi, signer);

  cached = {
    provider,
    signer,
    contract,
    artifact,
    address: env.CONTRACT_ADDRESS,
  };

  return cached;
};

/** Test hook — forces the next getConnection() to rebuild. */
const resetConnection = () => {
  cached = null;
};

module.exports = {
  ARTIFACT_PATH,
  getConnection,
  resetConnection,
};
