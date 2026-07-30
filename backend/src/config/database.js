const mongoose = require("mongoose");
const { env } = require("./env");

const connectDatabase = async () => {
  mongoose.set("strictQuery", true);

  /**
   * Index building is left on unless explicitly disabled. On a managed cluster
   * you would build indexes once by hand and set DISABLE_AUTO_INDEX=true (see
   * docs/deployment-guide.md); leaving it on by default means a fresh database
   * is never silently left doing collection scans.
   */
  const connection = await mongoose.connect(env.MONGODB_URI, {
    autoIndex: !env.DISABLE_AUTO_INDEX,
  });

  console.log(`MongoDB connected: ${connection.connection.host}`);
  return connection;
};

module.exports = { connectDatabase };
