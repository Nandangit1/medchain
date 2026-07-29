const mongoose = require("mongoose");

const { connectDatabase } = require("../config/database");
const { BLOCKCHAIN_SYNC_STATUS } = require("../constants/records");
const MedicalRecord = require("../models/MedicalRecord");
const User = require("../models/User");
const blockchainService = require("../services/blockchainService");

/**
 * Anchors every record that is not yet confirmed on-chain.
 *
 * This is what makes blockchain support safely opt-in: records uploaded while
 * BLOCKCHAIN_ENABLED was false, or while the node was unreachable, sit at
 * status "pending" or "failed" and are picked up here. Safe to re-run — the
 * contract rejects duplicate content hashes, and confirmed records are skipped.
 *
 *   npm run backfill:anchors
 */
const run = async () => {
  if (!blockchainService.isEnabled()) {
    console.error("BLOCKCHAIN_ENABLED is false. Enable it in .env before running this script.");
    process.exitCode = 1;
    return;
  }

  await connectDatabase();

  const status = await blockchainService.getStatus();
  if (!status.connected) {
    console.error(`Cannot reach the chain: ${status.reason}`);
    process.exitCode = 1;
    await mongoose.connection.close();
    return;
  }

  console.log(`Connected to chain ${status.chainId} at block ${status.blockNumber}`);
  console.log(`Contract: ${status.contractAddress}\n`);

  const pending = await MedicalRecord.find({
    isDeleted: { $ne: true },
    "blockchain.status": { $ne: BLOCKCHAIN_SYNC_STATUS.CONFIRMED },
  })
    .select("+encryption")
    .sort({ createdAt: 1 })
    .exec();

  if (pending.length === 0) {
    console.log("Nothing to backfill — every record is already anchored.");
    await mongoose.connection.close();
    return;
  }

  console.log(`Found ${pending.length} record(s) to anchor.\n`);

  let confirmed = 0;
  let failed = 0;

  // Sequential on purpose: parallel sends from one key produce nonce conflicts.
  for (const record of pending) {
    const patient = await User.findById(record.patient).select("+isActive");

    if (!patient) {
      console.log(`  SKIP  ${record._id} — owning patient no longer exists`);
      failed += 1;
      continue;
    }

    const anchor = await blockchainService.anchorRecord({ patient, record });

    record.blockchain = anchor;
    await record.save({ validateBeforeSave: false });

    if (anchor.status === BLOCKCHAIN_SYNC_STATUS.CONFIRMED) {
      console.log(`  OK    ${record._id} -> on-chain id ${anchor.onChainId} (${anchor.txHash})`);
      confirmed += 1;
    } else {
      console.log(`  FAIL  ${record._id} — ${anchor.lastError}`);
      failed += 1;
    }
  }

  console.log(`\nDone. ${confirmed} confirmed, ${failed} failed.`);
  await mongoose.connection.close();
};

run().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
  await mongoose.connection.close().catch(() => {});
});
