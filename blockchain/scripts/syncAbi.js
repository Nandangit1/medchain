const fs = require("fs");
const path = require("path");

/**
 * Publishes a deployed contract's address and ABI to the backend.
 *
 * scripts/deploy.js already does this inline. Ignition does not: it writes its
 * own deployment journal under ignition/deployments/ and knows nothing about
 * this repository's backend. This script bridges that gap so both deployment
 * paths leave the API correctly wired.
 *
 *   npx hardhat run scripts/syncAbi.js --network localhost
 *
 * Reads the most recent Ignition deployment for the connected chain and writes
 * backend/src/config/contracts/TelemedicineRecords.json.
 */
const CONTRACT_NAME = "TelemedicineRecords";
const MODULE_KEY = `TelemedicineRecordsModule#${CONTRACT_NAME}`;

async function main() {
  const { artifacts, network } = require("hardhat");

  const chainId = network.config.chainId;
  const deploymentDir = path.join(__dirname, "..", "ignition", "deployments", `chain-${chainId}`);
  const addressesPath = path.join(deploymentDir, "deployed_addresses.json");

  if (!fs.existsSync(addressesPath)) {
    throw new Error(
      `No Ignition deployment found for chain ${chainId}.\n` +
        `Expected: ${addressesPath}\n\n` +
        "Deploy first:\n" +
        `  npx hardhat ignition deploy ./ignition/modules/${CONTRACT_NAME}.js --network ${network.name}`
    );
  }

  const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"));
  const address = addresses[MODULE_KEY];

  if (!address) {
    throw new Error(
      `Deployment exists but has no entry for "${MODULE_KEY}".\n` +
        `Found: ${Object.keys(addresses).join(", ") || "(nothing)"}`
    );
  }

  const { abi } = await artifacts.readArtifact(CONTRACT_NAME);

  const target = path.join(
    __dirname,
    "..",
    "..",
    "backend",
    "src",
    "config",
    "contracts",
    `${CONTRACT_NAME}.json`
  );

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(
    target,
    `${JSON.stringify(
      {
        contract: CONTRACT_NAME,
        network: network.name,
        chainId: Number(chainId),
        address,
        deployedAt: new Date().toISOString(),
        source: "hardhat-ignition",
        abi,
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  console.log(`\nSynced ${CONTRACT_NAME} to the backend.`);
  console.log(`  Address : ${address}`);
  console.log(`  Network : ${network.name} (chainId ${chainId})`);
  console.log(`  Written : ${target}`);
  console.log("\nSet this in backend/.env, then restart the API:");
  console.log(`  CONTRACT_ADDRESS=${address}`);
  console.log("  BLOCKCHAIN_ENABLED=true\n");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
