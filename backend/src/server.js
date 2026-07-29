const app = require("./app");
const { connectDatabase } = require("./config/database");
const { env } = require("./config/env");

let server;

const startServer = async () => {
  await connectDatabase();

  server = app.listen(env.PORT, () => {
    console.log(`API server running on port ${env.PORT} in ${env.NODE_ENV} mode`);
  });
};

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception. Shutting down.");
  console.error(error);
  process.exit(1);
});

process.on("unhandledRejection", (error) => {
  console.error("Unhandled rejection. Shutting down.");
  console.error(error);

  if (server) {
    server.close(() => process.exit(1));
  } else {
    process.exit(1);
  }
});

startServer();
