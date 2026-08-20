const os = require("os");

const app = require("./app");
const { canServeFrontend } = require("./app");
const { connectDatabase } = require("./config/database");
const { env } = require("./config/env");
const { seedAdminOnBoot } = require("./services/seedService");

let server;

/** First non-internal IPv4 address, so the LAN URL can be printed. */
const lanAddress = () => {
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const details of interfaces || []) {
      if (details.family === "IPv4" && !details.internal) {
        return details.address;
      }
    }
  }

  return null;
};

const banner = () => {
  const port = env.PORT;
  const suffix = port === 80 ? "" : `:${port}`;
  const lan = lanAddress();

  // ASCII only: the Windows console codepage garbles box-drawing characters.
  console.log("");
  console.log("  MedChain - Secure Telemedicine");
  console.log("  ---------------------------------------------");

  if (canServeFrontend) {
    console.log(`  Web app      http://localhost${suffix}`);
    console.log(`  Also at      http://medchain.local${suffix}  (needs the hosts entry)`);
    if (lan) {
      console.log(`  On network   http://${lan}${suffix}  (phones, other machines)`);
    }
  } else {
    console.log(`  API only     http://localhost${suffix}/api`);
    console.log("  Web app      served separately (npm run dev in frontend/)");
  }

  console.log(`  Health       http://localhost${suffix}/api/v1/health`);
  console.log(`  Mode         ${env.NODE_ENV}${env.TRUST_TLS ? " (TLS trusted)" : ""}`);
  console.log("");
};

const startServer = async () => {
  await connectDatabase();

  // Before accepting traffic, so a hosted first deploy is never briefly live
  // with no administrator. No-op unless SEED_ADMIN_ON_BOOT is set.
  await seedAdminOnBoot();

  // 0.0.0.0 rather than the default, so LAN devices can reach it.
  server = app.listen(env.PORT, "0.0.0.0", banner);
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

/** Graceful shutdown so in-flight requests finish and Mongo closes cleanly. */
["SIGTERM", "SIGINT"].forEach((signal) => {
  process.on(signal, () => {
    console.log(`\n${signal} received. Closing server.`);

    if (server) {
      server.close(() => process.exit(0));
    } else {
      process.exit(0);
    }
  });
});

startServer();
