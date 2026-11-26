const os = require("os");

const app = require("./app");
const { canServeFrontend } = require("./app");
const { connectDatabase } = require("./config/database");
const { env } = require("./config/env");
const { seedAdminOnBoot } = require("./services/seedService");
const telegramService = require("./services/telegramService");
const chainSyncService = require("./services/chainSyncService");

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

  // After listen, so a webhook registered here can be answered immediately.
  // Never fatal: a bad token logs an error and the site runs without Telegram.
  telegramService.start();

  // Re-drives anything not yet on-chain, then keeps doing so periodically.
  chainSyncService.start();

  startKeepAwake();
};

/**
 * Render's free tier stops an instance after ~15 minutes without inbound
 * requests, and the next visitor waits 30-60 s for it to boot. A request to
 * the site's own public URL goes out through Render's proxy and back in, so
 * it counts as traffic and the instance never idles out.
 *
 * Self-contained on purpose: the GitHub Actions ping is a second line, but
 * GitHub pauses scheduled workflows after 60 days without a commit, which is
 * exactly when nobody is around to notice. Only runs on Render, and can be
 * switched off with KEEP_AWAKE=false.
 */
const KEEP_AWAKE_INTERVAL_MS = 10 * 60 * 1000;

const startKeepAwake = () => {
  const onRender = process.env.RENDER === "true";
  const disabled = String(process.env.KEEP_AWAKE || "").toLowerCase() === "false";

  if (!onRender || disabled || !/^https:\/\//.test(env.APP_URL)) return;

  const target = `${env.APP_URL}/api/v1/health`;
  const timer = setInterval(() => {
    fetch(target, { signal: AbortSignal.timeout(30000) }).catch(() => null);
  }, KEEP_AWAKE_INTERVAL_MS);
  timer.unref?.();
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
    telegramService.stop();
    chainSyncService.stop();

    if (server) {
      server.close(() => process.exit(0));
    } else {
      process.exit(0);
    }
  });
});

startServer();
