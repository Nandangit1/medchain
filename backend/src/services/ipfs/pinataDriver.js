const { env } = require("../../config/env");
const { IPFS_DRIVERS } = require("../../constants/records");
const AppError = require("../../utils/AppError");

/**
 * Pinata IPFS driver.
 *
 * Talks to the Pinata REST API using the global fetch/FormData/Blob available
 * in Node 18+, so no HTTP client dependency is required. Implements the same
 * contract as the local driver:
 *
 *   upload(buffer, options) -> { cid, size, provider, gatewayUrl }
 *   fetchByCid(cid)         -> Buffer
 *   unpin(cid)              -> boolean
 */
const REQUEST_TIMEOUT_MS = 30000;

const authHeaders = () => ({ Authorization: `Bearer ${env.PINATA_JWT}` });

/**
 * Every outbound call is bounded: a hung pin request must not hold an Express
 * connection open indefinitely.
 */
const requestWithTimeout = async (url, options) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new AppError("The IPFS provider did not respond in time. Please retry.", 504);
    }

    throw new AppError(`Unable to reach the IPFS provider: ${error.message}`, 502);
  } finally {
    clearTimeout(timeout);
  }
};

const upload = async (buffer, { fileName, metadata = {} } = {}) => {
  const form = new FormData();

  form.append("file", new Blob([buffer]), fileName || "record.bin");
  form.append(
    "pinataMetadata",
    JSON.stringify({
      name: fileName || "medical-record",
      keyvalues: metadata,
    })
  );
  form.append("pinataOptions", JSON.stringify({ cidVersion: 1 }));

  const response = await requestWithTimeout(`${env.PINATA_API_URL}/pinning/pinFileToIPFS`, {
    method: "POST",
    headers: authHeaders(),
    body: form,
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new AppError(
      `Pinata rejected the upload (HTTP ${response.status}). ${details}`.trim(),
      502
    );
  }

  const result = await response.json();

  return {
    cid: result.IpfsHash,
    size: result.PinSize ?? buffer.length,
    provider: IPFS_DRIVERS.PINATA,
    gatewayUrl: `${env.PINATA_GATEWAY_URL}/ipfs/${result.IpfsHash}`,
    fileName,
  };
};

const fetchByCid = async (cid) => {
  const response = await requestWithTimeout(`${env.PINATA_GATEWAY_URL}/ipfs/${cid}`, {
    method: "GET",
  });

  if (!response.ok) {
    throw new AppError(
      `Failed to retrieve ${cid} from IPFS (HTTP ${response.status}).`,
      response.status === 404 ? 404 : 502
    );
  }

  return Buffer.from(await response.arrayBuffer());
};

const unpin = async (cid) => {
  const response = await requestWithTimeout(`${env.PINATA_API_URL}/pinning/unpin/${cid}`, {
    method: "DELETE",
    headers: authHeaders(),
  });

  return response.ok;
};

module.exports = {
  fetchByCid,
  name: IPFS_DRIVERS.PINATA,
  unpin,
  upload,
};
