const jwt = require("jsonwebtoken");
const { env } = require("../config/env");

const signJwt = (payload) =>
  jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
  });

module.exports = { signJwt };
