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

const loadArtifact = () => {
  if (!fs.existsSync(ARTIFACT_PATH)) {
    throw new Error(
      `Contract artifact not found at ${ARTIFACT_PATH}. ` +
        "Deploy the contract first: cd blockchain && npx hardhat run scripts/deploy.js --network localhost"
    );
  }

  const artifact = JSON.parse(fs.readFileSync(ARTIFACT_PATH, "utf8"));

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
