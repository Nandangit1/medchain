const fs = require("fs");
const path = require("path");
const compression = require("compression");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const express = require("express");
const mongoSanitize = require("express-mongo-sanitize");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const hpp = require("hpp");
const morgan = require("morgan");

const { env } = require("./config/env");
const AppError = require("./utils/AppError");
const adminRoutes = require("./routes/adminRoutes");
const appointmentRoutes = require("./routes/appointmentRoutes");
const authRoutes = require("./routes/authRoutes");
const doctorRoutes = require("./routes/doctorRoutes");
const healthRoutes = require("./routes/healthRoutes");
const medicalRecordRoutes = require("./routes/medicalRecordRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const patientRoutes = require("./routes/patientRoutes");
const globalErrorHandler = require("./middlewares/errorMiddleware");

const app = express();

app.set("trust proxy", 1);
app.disable("x-powered-by");

/**
 * Where the built React app lives when this server hosts it directly.
 * Resolved once so both the static handler and the SPA fallback agree.
 */
const FRONTEND_DIST = path.resolve(__dirname, "..", "..", "frontend", "dist");
const FRONTEND_INDEX = path.join(FRONTEND_DIST, "index.html");
const canServeFrontend = env.SERVE_FRONTEND && fs.existsSync(FRONTEND_INDEX);

/**
 * `upgrade-insecure-requests` is in Helmet's default CSP. It tells the browser
 * to rewrite subresource requests to https, which breaks a site served over
 * plain http — every asset would fail. It is therefore only kept when TLS is
 * actually in use.
 */
const cspDirectives = {
  ...helmet.contentSecurityPolicy.getDefaultDirectives(),
  "img-src": ["'self'", "data:", "blob:"],
  "connect-src": ["'self'"],
  // Decrypted files are handed to the browser as blob: URLs for download.
  "media-src": ["'self'", "blob:"],
  "frame-ancestors": ["'none'"],
};

if (!env.TRUST_TLS) {
  delete cspDirectives["upgrade-insecure-requests"];
}

app.use(
  helmet({
    contentSecurityPolicy: { directives: cspDirectives },
    // Would otherwise block the blob: downloads the record viewer creates.
    crossOriginEmbedderPolicy: false,
  })
);

/**
 * When this server also serves the frontend, the browser is same-origin and
 * never triggers CORS. This allow-list covers the cases where it does talk to
 * the API directly — a separately deployed frontend, or a tool like Postman.
 *
 * A request with no Origin header (server-to-server, curl, a dev proxy) is
 * allowed: CORS is a browser protection, and refusing those would break the
 * proxy without adding any security.
 */
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || env.CORS_ORIGINS.includes(origin.replace(/\/$/, ""))) {
        return callback(null, true);
      }

      return callback(new AppError(`Origin ${origin} is not permitted by CORS policy.`, 403));
    },
    credentials: true,
  })
);

app.use(compression());

if (env.NODE_ENV === "development") {
  app.use(morgan("dev"));
}

/**
 * Rate limiting applies to the API only. Counting static asset requests would
 * exhaust a visitor's budget on the first page load, since one page pulls
 * several dozen files.
 *
 * This ceiling is abuse mitigation, not the security control — the real
 * protection is the 10-per-15-minutes limiter on the credential routes in
 * authRoutes.js. It is set generously because a legitimate session is
 * request-heavy: a dashboard alone fires several calls, and the integration
 * suite makes a few hundred. Too tight a global limit breaks honest clients
 * while doing nothing extra against a determined attacker.
 */
app.use(
  "/api",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 1000,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    // Uptime monitors poll health constantly; that should not consume a budget.
    skip: (req) => req.path.startsWith("/v1/health"),
    message: {
      status: "fail",
      message: "Too many requests from this IP. Please try again later.",
    },
  })
);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
// Required for the httpOnly refresh-token cookie.
app.use(cookieParser());
app.use(mongoSanitize());
app.use(hpp());

// --- API -------------------------------------------------------------------

app.use("/api/v1/health", healthRoutes);
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/admin", adminRoutes);
app.use("/api/v1/records", medicalRecordRoutes);
app.use("/api/v1/patients", patientRoutes);
app.use("/api/v1/doctors", doctorRoutes);
app.use("/api/v1/appointments", appointmentRoutes);
app.use("/api/v1/notifications", notificationRoutes);

/** Machine-readable index, still available when the SPA is mounted at "/". */
app.get("/api", (_req, res) => {
  res.status(200).json({
    status: "success",
    message: "MedChain API is running.",
    data: {
      health: "/api/v1/health",
      auth: "/api/v1/auth",
      admin: "/api/v1/admin",
      records: "/api/v1/records",
      patients: "/api/v1/patients",
      doctors: "/api/v1/doctors",
      appointments: "/api/v1/appointments",
      notifications: "/api/v1/notifications",
    },
  });
});

// --- Frontend --------------------------------------------------------------

if (canServeFrontend) {
  /**
   * Hashed asset filenames make a long immutable cache safe. index.html must
   * never be cached, or a returning visitor loads an old shell that references
   * assets the new deployment no longer has.
   */
  app.use(
    express.static(FRONTEND_DIST, {
      index: false,
      setHeaders(res, filePath) {
        if (filePath.endsWith("index.html")) {
          res.setHeader("Cache-Control", "no-store");
        } else if (/\.[0-9a-zA-Z]{8,}\.(js|css|woff2?|svg|png|jpg|webp)$/.test(filePath)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    })
  );

  /**
   * SPA fallback. React Router owns client-side paths, so any GET that is not
   * an API call and not a real file must return the app shell — otherwise
   * refreshing /patient/records would 404.
   */
  app.get(/^(?!\/api\/).+/, (req, res, next) => {
    if (req.method !== "GET" || req.path.includes(".")) {
      return next();
    }

    return res.sendFile(FRONTEND_INDEX);
  });
} else {
  // API-only mode: keep the root informative rather than a bare 404.
  app.get("/", (_req, res) => {
    res.status(200).json({
      status: "success",
      message: "MedChain API is running. The web app is served separately.",
      data: { api: "/api", health: "/api/v1/health" },
    });
  });
}

app.all("*", (req, _res, next) => {
  next(new AppError(`Route ${req.originalUrl} was not found.`, 404));
});

app.use(globalErrorHandler);

module.exports = app;
module.exports.canServeFrontend = canServeFrontend;
module.exports.FRONTEND_DIST = FRONTEND_DIST;
