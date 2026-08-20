const mongoose = require("mongoose");

const { connectDatabase } = require("../config/database");

/**
 * Builds every index declared by the Mongoose schemas, against whatever
 * database MONGODB_URI points at.
 *
 * Why this exists rather than a list of createIndex() calls in the deployment
 * guide: a hand-maintained list drifts. Indexes were added to the schemas for
 * health attributes, vital signs and appointments after that list was written,
 * and nothing forces the two to agree. Reading them off the models cannot
 * drift, because the models are what the application queries through.
 *
 * Two of these indexes are load-bearing rather than merely fast:
 *
 *   AccessPermission { record, doctor } unique on non-revoked rows
 *   Appointment      { doctor, scheduledFor } unique on live statuses
 *
 * Both are PARTIAL uniques. Without the partial filter, re-granting a doctor
 * who was previously revoked, and rebooking a slot that was cancelled, would
 * both fail on a duplicate-key error. Building them from the schemas keeps
 * that filter attached.
 *
 * Run once against a managed cluster before setting DISABLE_AUTO_INDEX=true:
 *
 *   MONGODB_URI="mongodb+srv://..." npm run ensure:indexes
 *
 * createIndexes() only adds what is missing. It never drops an index that the
 * schemas do not mention, so an index added by hand for an ad-hoc report
 * survives this.
 */
const MODEL_FILES = [
  "AccessPermission",
  "Appointment",
  "AuditLog",
  "BlockchainTransaction",
  "Diagnosis",
  "HealthAttribute",
  "MedicalRecord",
  "Notification",
  "Token",
  "User",
  "VitalSign",
];

const ensureIndexes = async () => {
  for (const name of MODEL_FILES) {
    const model = require(`../models/${name}`);

    await model.createIndexes();

    const indexes = await model.collection.indexes();
    console.log(`${name.padEnd(24)} ${indexes.length} index(es) on ${model.collection.name}`);
  }
};

connectDatabase()
  .then(ensureIndexes)
  .then(() => console.log("\nAll schema indexes are present."))
  .then(() => mongoose.connection.close())
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    mongoose.connection.close().finally(() => process.exit(1));
  });
