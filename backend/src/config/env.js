const dotenv = require("dotenv");

const { IPFS_DRIVERS } = require("../constants/records");

dotenv.config();

const requiredKeys = ["MONGODB_URI", "JWT_SECRET", "FILE_ENCRYPTION_KEY"];

const missingKeys = requiredKeys.filter((key) => !process.env[key]);

if (missingKeys.length > 0) {
  throw new Error(`Missing required environment variables: ${missingKeys.join(", ")}`);
}

if (process.env.JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET must contain at least 32 characters.");
}

/**
 * The master key wraps every per-file content key, so an invalid length here
 * must stop the process rather than surface as a runtime crypto error during
 * the first upload.
 */
if (!/^[0-9a-fA-F]{64}$/.test(process.env.FILE_ENCRYPTION_KEY)) {
  throw new Error(
    "FILE_ENCRYPTION_KEY must be a 32-byte key encoded as exactly 64 hexadecimal characters. " +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
  );
}

const ipfsDriver = (process.env.IPFS_DRIVER || IPFS_DRIVERS.LOCAL).toLowerCase();

if (!Object.values(IPFS_DRIVERS).includes(ipfsDriver)) {
  throw new Error(
    `IPFS_DRIVER must be one of: ${Object.values(IPFS_DRIVERS).join(", ")}. Received "${ipfsDriver}".`
  );
}

if (ipfsDriver === IPFS_DRIVERS.PINATA && !process.env.PINATA_JWT) {
  throw new Error('PINATA_JWT is required when IPFS_DRIVER is set to "pinata".');
}

/**
 * Blockchain anchoring is opt-in. With BLOCKCHAIN_ENABLED=false the whole
 * platform still runs exactly as it did in Module 3 — records simply stay at
 * blockchain.status "pending" until a chain is available and the backfill
 * script is run. This keeps the API demonstrable with no node running.
 */
const blockchainEnabled = String(process.env.BLOCKCHAIN_ENABLED || "false").toLowerCase() === "true";

if (blockchainEnabled) {
  const chainKeys = ["CONTRACT_ADDRESS", "REGISTRAR_PRIVATE_KEY", "CUSTODIAL_WALLET_SEED"];
  const missingChainKeys = chainKeys.filter((key) => !process.env[key]);

  if (missingChainKeys.length > 0) {
    throw new Error(
      `BLOCKCHAIN_ENABLED is true but these are missing: ${missingChainKeys.join(", ")}.`
    );
  }

  if (!/^0x[0-9a-fA-F]{40}$/.test(process.env.CONTRACT_ADDRESS)) {
    throw new Error("CONTRACT_ADDRESS must be a 20-byte hex address starting with 0x.");
  }

  if (!/^0x[0-9a-fA-F]{64}$/.test(process.env.REGISTRAR_PRIVATE_KEY)) {
    throw new Error("REGISTRAR_PRIVATE_KEY must be a 32-byte hex private key starting with 0x.");
  }

  if (!/^[0-9a-fA-F]{64}$/.test(process.env.CUSTODIAL_WALLET_SEED)) {
    throw new Error("CUSTODIAL_WALLET_SEED must be exactly 64 hexadecimal characters.");
  }
}

const env = {
  NODE_ENV: process.env.NODE_ENV || "development",
  PORT: Number(process.env.PORT || 5000),
  MONGODB_URI: process.env.MONGODB_URI,
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || "1d",
  /**
   * Comma-separated list, so the same backend serves medchain.local, localhost
   * and a LAN address without reconfiguration. Kept as a raw string for logging;
   * `CORS_ORIGINS` below is the parsed form the CORS middleware uses.
   */
  CORS_ORIGIN: process.env.CORS_ORIGIN || "http://medchain.local,http://localhost",
  CORS_ORIGINS: (process.env.CORS_ORIGIN || "http://medchain.local,http://localhost")
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean),
  ADMIN_NAME: process.env.ADMIN_NAME,
  ADMIN_EMAIL: process.env.ADMIN_EMAIL,
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
  FILE_ENCRYPTION_KEY: process.env.FILE_ENCRYPTION_KEY,
  IPFS_DRIVER: ipfsDriver,
  PINATA_JWT: process.env.PINATA_JWT,
  PINATA_API_URL: process.env.PINATA_API_URL || "https://api.pinata.cloud",
  PINATA_GATEWAY_URL: process.env.PINATA_GATEWAY_URL || "https://gateway.pinata.cloud",
  LOCAL_IPFS_PATH: process.env.LOCAL_IPFS_PATH || "./.local/ipfs",
  MAX_UPLOAD_SIZE_MB: Number(process.env.MAX_UPLOAD_SIZE_MB || 10),
  /**
   * When true, this server also serves frontend/dist — one process, one port,
   * one origin. That removes CORS entirely and makes the refresh cookie
   * straightforward. Requires `npm run build` in frontend/ first.
   */
  SERVE_FRONTEND: String(process.env.SERVE_FRONTEND || "false").toLowerCase() === "true",
  DISABLE_AUTO_INDEX: String(process.env.DISABLE_AUTO_INDEX || "false").toLowerCase() === "true",
  /**
   * Set only when the app is genuinely behind TLS. It controls the `secure`
   * cookie flag and whether CSP asks the browser to upgrade requests to https —
   * both of which break a site served over plain http.
   */
  TRUST_TLS:
    String(process.env.TRUST_TLS || (process.env.NODE_ENV === "production" ? "true" : "false"))
      .toLowerCase() === "true",
  BLOCKCHAIN_ENABLED: blockchainEnabled,
  BLOCKCHAIN_RPC_URL: process.env.BLOCKCHAIN_RPC_URL || "http://127.0.0.1:8545",
  BLOCKCHAIN_CHAIN_ID: Number(process.env.BLOCKCHAIN_CHAIN_ID || 31337),
  BLOCKCHAIN_CONFIRMATIONS: Number(process.env.BLOCKCHAIN_CONFIRMATIONS || 1),
  CONTRACT_ADDRESS: process.env.CONTRACT_ADDRESS,
  REGISTRAR_PRIVATE_KEY: process.env.REGISTRAR_PRIVATE_KEY,
  CUSTODIAL_WALLET_SEED: process.env.CUSTODIAL_WALLET_SEED,
};

module.exports = { env };
