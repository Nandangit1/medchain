const mongoose = require("mongoose");

const { connectDatabase } = require("../config/database");
const { env } = require("../config/env");
const { ROLES } = require("../constants/roles");
const User = require("../models/User");

const seedAdmin = async () => {
  if (!env.ADMIN_NAME || !env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) {
    throw new Error("ADMIN_NAME, ADMIN_EMAIL, and ADMIN_PASSWORD are required to seed an admin.");
  }

  const existingAdmin = await User.findOne({ email: env.ADMIN_EMAIL.toLowerCase() });

  if (existingAdmin) {
    console.log(`Admin already exists: ${existingAdmin.email}`);
    return;
  }

  const admin = await User.create({
    name: env.ADMIN_NAME,
    email: env.ADMIN_EMAIL,
    password: env.ADMIN_PASSWORD,
    role: ROLES.ADMIN,
  });

  console.log(`Admin created: ${admin.email}`);
};

connectDatabase()
  .then(seedAdmin)
  .then(() => mongoose.connection.close())
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    mongoose.connection.close().finally(() => process.exit(1));
  });
