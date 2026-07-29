const fs = require("fs");
const path = require("path");
const { ethers, network, artifacts } = require("hardhat");

/**
 * Deploys TelemedicineRecords and publishes the address + ABI where the
 * backend can pick them up.
 *
 * Two artefacts are written:
 *   blockchain/deployments/<network>.json          full record, git-ignored
 *   backend/src/config/contracts/TelemedicineRecords.json   address + ABI
 *
 * The second file is what `backend/src/config/blockchain.js` loads, so a
 * deployment immediately wires itself into the API with no manual copying.
 *
 * Usage:
 *   npx hardhat run scripts/deploy.js                    # ephemeral in-process chain
 *   npx hardhat run scripts/deploy.js --network localhost
 *   npx hardhat run scripts/deploy.js --network sepolia
 */
async function main() {
  const signers = await ethers.getSigners();
  const [deployer] = signers;

  /**
   * On a local chain the registrar is a second account, which keeps the admin
   * and backend service keys separated exactly as they would be in production.
   * On a live network only one key is configured, so it plays both roles.
   */
  const registrar = signers[1] ?? deployer;

  console.log(`Network   : ${network.name} (chainId ${network.config.chainId})`);
  console.log(`Deployer  : ${deployer.address}`);
  console.log(`Registrar : ${registrar.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance   : ${ethers.formatEther(balance)} ETH\n`);

  if (balance === 0n) {
    throw new Error("Deployer has a zero balance. Fund the account before deploying.");
  }

  const Factory = await ethers.getContractFactory("TelemedicineRecords");
  const contract = await Factory.deploy(deployer.address, registrar.address);

  console.log("Deploying TelemedicineRecords...");
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  const deploymentTx = contract.deploymentTransaction();
  const receipt = await deploymentTx.wait();

  console.log(`\nDeployed to : ${address}`);
  console.log(`Tx hash     : ${receipt.hash}`);
  console.log(`Block       : ${receipt.blockNumber}`);
  console.log(`Gas used    : ${receipt.gasUsed.toString()}`);

  const { abi } = await artifacts.readArtifact("TelemedicineRecords");

  const deployment = {
    contract: "TelemedicineRecords",
    network: network.name,
    chainId: Number(network.config.chainId),
    address,
    admin: deployer.address,
    registrar: registrar.address,
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    deployedAt: new Date().toISOString(),
    abi,
  };

  writeJson(path.join(__dirname, "..", "deployments", `${network.name}.json`), deployment);

  writeJson(
    path.join(__dirname, "..", "..", "backend", "src", "config", "contracts", "TelemedicineRecords.json"),
    {
      contract: deployment.contract,
      network: deployment.network,
      chainId: deployment.chainId,
      address: deployment.address,
      deployedAt: deployment.deployedAt,
      abi,
    }
  );

  console.log("\nNext steps:");
  console.log(`  1. Set CONTRACT_ADDRESS=${address} in backend/.env`);
  console.log("  2. Set BLOCKCHAIN_ENABLED=true in backend/.env");
  if (network.name === "localhost" || network.name === "hardhat") {
    console.log("  3. Set REGISTRAR_PRIVATE_KEY to the Hardhat account #1 key");
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  console.log(`Wrote ${filePath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
