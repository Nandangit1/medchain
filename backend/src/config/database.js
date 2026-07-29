const mongoose = require("mongoose");
const { env } = require("./env");

const connectDatabase = async () => {
  mongoose.set("strictQuery", true);

  const connection = await mongoose.connect(env.MONGODB_URI, {
    autoIndex: env.NODE_ENV !== "production",
  });

  console.log(`MongoDB connected: ${connection.connection.host}`);
  return connection;
};

module.exports = { connectDatabase };
