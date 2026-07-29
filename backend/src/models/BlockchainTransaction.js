const mongoose = require("mongoose");

const { BLOCKCHAIN_SYNC_STATUS, CHAIN_TX_TYPES } = require("../constants/records");

/**
 * Off-chain mirror of every transaction the platform submits.
 *
 * The chain is the source of truth, but querying it for "show me this
 * patient's transaction history" means scanning event logs, which is slow and
 * awkward to paginate. This collection keeps a queryable index and gives the
 * admin blockchain explorer (Module 10) something to page through.
 *
 * It also records FAILURES, which never reach the chain at all — without this
 * a failed anchor would leave no trace anywhere.
 */
const blockchainTransactionSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: Object.values(CHAIN_TX_TYPES),
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(BLOCKCHAIN_SYNC_STATUS),
      default: BLOCKCHAIN_SYNC_STATUS.PENDING,
      index: true,
    },
    txHash: { type: String, trim: true, index: true },
    blockNumber: { type: Number, min: 0 },
    gasUsed: { type: String, trim: true },
    /** Chain-side identifier, e.g. the record id returned by anchorRecord. */
    onChainId: { type: String, trim: true },

    initiatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    relatedUser: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    relatedRecord: { type: mongoose.Schema.Types.ObjectId, ref: "MedicalRecord", index: true },

    contractAddress: { type: String, trim: true },
    chainId: { type: Number },
    error: { type: String, trim: true, maxlength: 1000 },
    confirmedAt: Date,
  },
  { timestamps: true }
);

blockchainTransactionSchema.index({ createdAt: -1 });

blockchainTransactionSchema.methods.toClientObject = function toClientObject() {
  const tx = this.toObject();
  delete tx.__v;
  return tx;
};

const BlockchainTransaction = mongoose.model("BlockchainTransaction", blockchainTransactionSchema);

module.exports = BlockchainTransaction;
