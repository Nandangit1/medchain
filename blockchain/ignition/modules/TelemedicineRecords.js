const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");

/**
 * Hardhat Ignition deployment module.
 *
 * Declarative alternative to scripts/deploy.js. Ignition records what it has
 * already deployed, so re-running it against the same network is idempotent
 * rather than deploying a second copy — which is what makes it preferable for
 * anything beyond a throwaway local chain.
 *
 *   npx hardhat ignition deploy ./ignition/modules/TelemedicineRecords.js --network localhost
 *   npm run sync:abi        # publishes address + ABI to the backend
 *
 * Or use the wrapper that does both:
 *   npm run deploy:ignition
 */
module.exports = buildModule("TelemedicineRecordsModule", (m) => {
  /**
   * Account 0 is the platform administrator, account 1 the backend service
   * key. Separating them means a compromised service key cannot pause the
   * contract or re-assign roles.
   */
  const admin = m.getAccount(0);
  const registrar = m.getAccount(1);

  const telemedicineRecords = m.contract("TelemedicineRecords", [admin, registrar]);

  /**
   * The backend signs as the registrar but must also mirror admin decisions
   * on-chain — verifyDoctor is onlyRole(ADMIN_ROLE). Without this grant the
   * call reverts and every subsequent access grant fails, because the contract
   * refuses to grant access to a doctor it does not consider verified.
   *
   * DEFAULT_ADMIN_ROLE deliberately stays with account 0 alone, so that key
   * can revoke the registrar's privileges if the service key is ever exposed.
   */
  const adminRole = m.staticCall(telemedicineRecords, "ADMIN_ROLE");
  m.call(telemedicineRecords, "grantRole", [adminRole, registrar], {
    id: "grantAdminRoleToRegistrar",
  });

  return { telemedicineRecords };
});
