const { env } = require("../../config/env");
const { IPFS_DRIVERS } = require("../../constants/records");
const localDriver = require("./localDriver");
const pinataDriver = require("./pinataDriver");

/**
 * Factory Pattern — IPFS storage.
 *
 * The rest of the application depends on this stable interface and never on a
 * concrete provider:
 *
 *   upload(buffer, options) -> { cid, size, provider, gatewayUrl }
 *   fetchByCid(cid)         -> Buffer
 *   unpin(cid)              -> boolean
 *
 * Swapping IPFS_DRIVER between "local" and "pinata" therefore changes the
 * storage backend with no change to the service, controller or route layers,
 * and a third provider (Web3.Storage, Infura, a self-hosted Kubo node) can be
 * added by dropping in one more module that satisfies the same contract.
 */
const drivers = {
  [IPFS_DRIVERS.LOCAL]: localDriver,
  [IPFS_DRIVERS.PINATA]: pinataDriver,
};

/**
 * The driver is resolved once at startup. env.js has already validated that
 * the configured name is supported and that Pinata credentials are present
 * when required, so this cannot fail at request time.
 */
const activeDriver = drivers[env.IPFS_DRIVER];

const getDriver = () => activeDriver;

module.exports = {
  fetchByCid: (cid) => activeDriver.fetchByCid(cid),
  getDriver,
  name: activeDriver.name,
  unpin: (cid) => activeDriver.unpin(cid),
  upload: (buffer, options) => activeDriver.upload(buffer, options),
};
