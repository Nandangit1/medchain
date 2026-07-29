const fs = require("fs/promises");
const path = require("path");

const { env } = require("../../config/env");
const { IPFS_DRIVERS } = require("../../constants/records");
const AppError = require("../../utils/AppError");
const { toRawCidV1 } = require("../../utils/cid");

/**
 * Local content-addressed storage driver.
 *
 * Implements the same contract as the Pinata driver so the application can be
 * developed, demonstrated and tested with no third-party credentials and no
 * network access. Content addressing is preserved: the file name IS the
 * CIDv1 of its bytes, so storing the same payload twice is idempotent exactly
 * as it is on a real IPFS node.
 *
 * This is a development and demonstration driver. It provides no replication
 * or peer distribution — set IPFS_DRIVER=pinata for genuine IPFS pinning.
 */
const rootDirectory = () => path.resolve(process.cwd(), env.LOCAL_IPFS_PATH);

/** Sharded two levels deep to avoid a single directory with thousands of entries. */
const blockPath = (cid) => path.join(rootDirectory(), cid.slice(1, 3), cid);

const ensureDirectory = async (directory) => {
  await fs.mkdir(directory, { recursive: true });
};

const upload = async (buffer, { fileName } = {}) => {
  const cid = toRawCidV1(buffer);
  const target = blockPath(cid);

  await ensureDirectory(path.dirname(target));

  // Content addressing makes re-uploading identical bytes a no-op.
  try {
    await fs.access(target);
  } catch {
    await fs.writeFile(target, buffer);
  }

  return {
    cid,
    size: buffer.length,
    provider: IPFS_DRIVERS.LOCAL,
    gatewayUrl: `/api/v1/records/ipfs/${cid}`,
    fileName,
  };
};

const fetchByCid = async (cid) => {
  try {
    return await fs.readFile(blockPath(cid));
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new AppError(`Content ${cid} was not found in local IPFS storage.`, 404);
    }

    throw new AppError(`Failed to read ${cid} from local IPFS storage.`, 502);
  }
};

const unpin = async (cid) => {
  try {
    await fs.unlink(blockPath(cid));
    return true;
  } catch {
    // Unpinning is best-effort; a missing block is already the desired state.
    return false;
  }
};

module.exports = {
  fetchByCid,
  name: IPFS_DRIVERS.LOCAL,
  unpin,
  upload,
};
