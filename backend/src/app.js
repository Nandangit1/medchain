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

app.use(helmet());

/**
 * The frontend is normally proxied through the dev server, which makes requests
 * same-origin and bypasses CORS entirely. This allow-list covers the cases where
 * the browser does talk to the API directly — a separate deployment, or a tool
 * like Postman.
 *
 * A request with no Origin header (server-to-server, curl, the proxy itself) is
 * allowed: CORS is a browser protection, and refusing those would break the
 * proxy without adding security.
 */
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || env.CORS_ORIGINS.includes(origin.replace(/\/$/, ""))) {
        return callback(null, true);
      }

      return callback(new Error(`Origin ${origin} is not permitted by CORS policy.`));
    },
    credentials: true,
  })
);
app.use(compression());

if (env.NODE_ENV === "development") {
  app.use(morgan("dev"));
}

app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 200,
    standardHeaders: "draft-7",
    legacyHeaders: false,
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

app.get("/", (_req, res) => {
  res.status(200).json({
    status: "success",
    message: "Blockchain Telemedicine API is running.",
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

app.use("/api/v1/health", healthRoutes);
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/admin", adminRoutes);
app.use("/api/v1/records", medicalRecordRoutes);
app.use("/api/v1/patients", patientRoutes);
app.use("/api/v1/doctors", doctorRoutes);
app.use("/api/v1/appointments", appointmentRoutes);
app.use("/api/v1/notifications", notificationRoutes);

app.all("*", (req, _res, next) => {
  next(new AppError(`Route ${req.originalUrl} was not found.`, 404));
});

app.use(globalErrorHandler);

module.exports = app;
