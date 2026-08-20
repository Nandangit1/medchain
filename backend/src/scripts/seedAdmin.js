const mongoose = require("mongoose");

const { connectDatabase } = require("../config/database");
const { env } = require("../config/env");
const { seedAdmin } = require("../services/seedService");

/**
 * Command-line entry point. The logic lives in seedService so that hosted
 * deployments, which have no shell to run this from, can call the same
 * idempotent function during startup.
 */
connectDatabase()
  .then(seedAdmin)
  .then((outcome) => {
    if (outcome === "created") {
      console.log(`Admin created: ${env.ADMIN_EMAIL}`);
    } else {
      console.log(`Admin already exists: ${env.ADMIN_EMAIL}`);
    }
  })
  .then(() => mongoose.connection.close())
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    mongoose.connection.close().finally(() => process.exit(1));
  });
