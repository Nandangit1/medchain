const { ROLES } = require("../constants/roles");
const { env } = require("../config/env");
const logger = require("../config/logger");
const User = require("../models/User");

/**
 * Creates the administrator account if it is absent.
 *
 * Idempotent by design: it is run both from `npm run seed:admin` and from server
 * startup on platforms that offer no shell, so it must be safe to call on every
 * boot. An existing account is never modified — in particular the password is
 * left alone, so rotating ADMIN_PASSWORD in the environment does NOT reset a
 * live administrator's credentials. Changing the password is a deliberate act
 * through /auth/change-password, not a side effect of a redeploy.
 *
 * @returns {Promise<"created"|"exists">}
 */
const seedAdmin = async () => {
  if (!env.ADMIN_NAME || !env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) {
    throw new Error("ADMIN_NAME, ADMIN_EMAIL, and ADMIN_PASSWORD are required to seed an admin.");
  }

  const existingAdmin = await User.findOne({ email: env.ADMIN_EMAIL.toLowerCase() });

  if (existingAdmin) {
    return "exists";
  }

  await User.create({
    name: env.ADMIN_NAME,
    email: env.ADMIN_EMAIL,
    password: env.ADMIN_PASSWORD,
    role: ROLES.ADMIN,
  });

  return "created";
};

/**
 * Startup wrapper for hosted deployments.
 *
 * A managed platform such as Render builds from a blueprint and then runs one
 * command; there is no opportunity to run the seeder by hand, and no shell to
 * do it from afterwards. Without this, a first deploy against an empty database
 * produces a site with no administrator and no way to create one, because
 * registration only ever mints patients and doctors.
 *
 * A failure here is logged but never fatal. A running site missing its admin
 * can still be fixed by pointing the seed script at the same database; a site
 * that refuses to boot cannot be fixed at all from a platform with no shell.
 */
const seedAdminOnBoot = async () => {
  if (!env.SEED_ADMIN_ON_BOOT) {
    return;
  }

  try {
    const outcome = await seedAdmin();

    if (outcome === "created") {
      logger.info("Seeded the administrator account on boot.", { email: env.ADMIN_EMAIL });
    } else {
      logger.info("Administrator account already present; boot seed skipped.");
    }
  } catch (error) {
    logger.error("Boot seed failed. The site is up but may have no administrator.", {
      error: error.message,
    });
  }
};

module.exports = { seedAdmin, seedAdminOnBoot };
