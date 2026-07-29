require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

/**
 * Hardhat configuration for the Blockchain-Based Secure Telemedicine System.
 *
 * Ganache is intentionally not used. Hardhat Network provides the same local
 * chain plus Solidity stack traces and `console.log`, and Truffle/Ganache was
 * sunset in 2023.
 */
const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL || "";
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || "";

/** Only pass a key to a live network if it actually looks like one. */
const liveAccounts = /^0x[0-9a-fA-F]{64}$/.test(DEPLOYER_PRIVATE_KEY) ? [DEPLOYER_PRIVATE_KEY] : [];

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      // "paris" keeps the bytecode free of PUSH0, which some L2s and older
      // testnet clients still do not accept.
      evmVersion: "paris",
    },
  },

  networks: {
    hardhat: {
      chainId: 31337,
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
    sepolia: {
      url: SEPOLIA_RPC_URL,
      accounts: liveAccounts,
      chainId: 11155111,
    },
  },

  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    currency: "USD",
  },

  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY || "",
  },

  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },

  mocha: {
    timeout: 60000,
  },
};
