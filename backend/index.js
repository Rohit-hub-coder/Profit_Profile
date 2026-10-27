require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const passport = require("passport");
const LocalStrategy = require("passport-local");
const session = require("express-session");
const bodyParser = require("body-parser");
const nodemailer = require("nodemailer");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const validator = require("validator");

// Fail-fast if SESSION_SECRET is missing
if (!process.env.SESSION_SECRET) {
  process.stderr.write("FATAL: SESSION_SECRET environment variable is missing.\n");
  process.exit(1);
}

const port = process.env.PORT || 3001;
const url = process.env.MONGO_URL || "mongodb://localhost:27017/profitprofile";

const { HoldingsModel } = require("./models/holdings");
const { PosModel } = require("./models/positions");
const { OrdersModel } = require("./models/orders");
const { UserModel } = require("./models/users");

// In-memory OTP store: email -> { otp, expiresAt, attempts, lastSent }
const otpStore = new Map();

const app = express();

// Security headers
app.use(helmet());

// CORS allowlist configuration (no wildcard)
const defaultAllowedOrigins = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3002",
  "http://localhost:3003",
];

const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean)
  : defaultAllowedOrigins;

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("CORS policy violation"));
      }
    },
    credentials: true,
    optionsSuccessStatus: 200,
  })
);

app.use(bodyParser.json({ limit: "50kb" }));

// Session handling with secure cookies & maxAge
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());

passport.use(new LocalStrategy(UserModel.authenticate()));
passport.serializeUser(UserModel.serializeUser());
passport.deserializeUser(UserModel.deserializeUser());

// Rate limiters
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts, please try again later." },
});

const sendOtpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many OTP requests from this IP, try again later." },
});

// Periodic OTP store cleanup
const otpCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [email, record] of otpStore.entries()) {
    if (record.expiresAt <= now) {
      otpStore.delete(email);
    }
  }
}, 60 * 1000);

// Utility
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function sanitizeInputString(val) {
  if (typeof val !== "string") return "";
  return val.replace(/[${}]/g, "").trim();
}

const transporter = nodemailer.createTransport({
  service: "Gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Routes
app.get("/allholdings", async (req, res, next) => {
  try {
    const allholdings = await HoldingsModel.find({});
    res.json({ data: allholdings });
  } catch (err) {
    next(err);
  }
});

app.get("/allpositions", async (req, res, next) => {
  try {
    const allpositions = await PosModel.find({});
    res.json({ data: allpositions });
  } catch (err) {
    next(err);
  }
});

app.get(["/allorders", "/allOrders"], async (req, res, next) => {
  try {
    const allorders = await OrdersModel.find({}).sort({ _id: -1 });
    res.json({ data: allorders });
  } catch (err) {
    next(err);
  }
});

app.post(["/neworder", "/newOrder"], async (req, res, next) => {
  try {
    const { name, qty, price, mode } = req.body;
    const sanitizedName = sanitizeInputString(name);
    const numericQty = Number(qty);
    const numericPrice = Number(price);
    const normalizedMode = typeof mode === "string" ? mode.trim().toUpperCase() : "";

    if (!sanitizedName || sanitizedName.length > 50) {
      return res.status(400).json({ error: "Invalid instrument name" });
    }
    if (!Number.isInteger(numericQty) || numericQty <= 0 || numericQty > 100000) {
      return res.status(400).json({ error: "Quantity must be a positive integer" });
    }
    if (isNaN(numericPrice) || numericPrice <= 0 || numericPrice > 10000000) {
      return res.status(400).json({ error: "Price must be a positive number" });
    }
    if (normalizedMode !== "BUY" && normalizedMode !== "SELL") {
      return res.status(400).json({ error: "Mode must be either BUY or SELL" });
    }

    const newOrder = new OrdersModel({
      name: sanitizedName,
      qty: numericQty,
      price: numericPrice,
      mode: normalizedMode,
    });
    await newOrder.save();
    res.status(201).json({ message: "Order created", order: newOrder });
  } catch (err) {
    next(err);
  }
});

app.post("/send-otp", sendOtpLimiter, async (req, res, next) => {
  try {
    const rawEmail = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    if (!rawEmail || !validator.isEmail(rawEmail)) {
      return res.status(400).json({ error: "Invalid email" });
    }
    const email = validator.normalizeEmail(rawEmail) || rawEmail;

    const now = Date.now();
    const existing = otpStore.get(email);
    if (existing && now - existing.lastSent < 30 * 1000) {
      return res.status(429).json({ error: "Please wait before requesting another OTP." });
    }

    const otp = generateOTP();
    const expiresAt = now + 5 * 60 * 1000;
    otpStore.set(email, {
      otp,
      expiresAt,
      attempts: 0,
      lastSent: now,
    });

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Your OTP Code from ProfitProfile",
      text: `Your OTP is ${otp}. It will expire in 5 minutes.`,
      html: `<p>Your OTP is <strong>${otp}</strong>. It will expire in 5 minutes.</p>`,
    };

    try {
      await transporter.sendMail(mailOptions);
      res.status(200).json({ message: "OTP sent" });
    } catch (_) {
      // In development fallback, allow test OTP without crashing
      res.status(200).json({ message: "OTP sent (dev fallback)", devOtp: otp });
    }
  } catch (err) {
    next(err);
  }
});

app.post("/verify-otp", (req, res) => {
  try {
    const rawEmail = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const rawOtp = typeof req.body?.otp === "string" ? req.body.otp.trim() : "";

    if (!rawEmail || !rawOtp || !validator.isEmail(rawEmail)) {
      return res.status(400).json({ error: "Invalid email or OTP format" });
    }
    if (!/^\d{6}$/.test(rawOtp)) {
      return res.status(400).json({ error: "OTP must be a 6-digit number" });
    }

    const email = validator.normalizeEmail(rawEmail) || rawEmail;
    const record = otpStore.get(email);
    if (!record) {
      return res.status(400).json({ error: "No OTP requested for this account." });
    }

    const now = Date.now();
    if (now > record.expiresAt) {
      otpStore.delete(email);
      return res.status(400).json({ error: "OTP expired" });
    }

    if (record.attempts >= 5) {
      otpStore.delete(email);
      return res.status(429).json({ error: "Too many wrong attempts. Request a new OTP." });
    }

    if (rawOtp !== record.otp) {
      record.attempts += 1;
      if (record.attempts >= 5) {
        otpStore.delete(email);
        return res.status(429).json({ error: "Too many wrong attempts. Request a new OTP." });
      }
      otpStore.set(email, record);
      return res.status(400).json({ error: "Incorrect OTP" });
    }

    otpStore.delete(email);
    res.status(200).json({ verified: true, message: "OTP verified" });
  } catch (err) {
    res.status(500).json({ error: "Verification failed" });
  }
});

// Centralized error handler: never leaks stack traces, consistent JSON format
app.use((err, req, res, next) => {
  const status = typeof err.status === "number" ? err.status : 500;
  const message = status === 500 ? "Internal server error" : err.message;
  res.status(status).json({ error: message });
});

// Database connection & Graceful Shutdown
mongoose
  .connect(url)
  .catch((err) => {
    process.stderr.write(`Mongo connection error: ${err.message}\n`);
  });

const server = app.listen(port, () => {});

const gracefulShutdown = () => {
  clearInterval(otpCleanupTimer);
  server.close(() => {
    mongoose.connection.close(false).then(() => {
      process.exit(0);
    });
  });
};

process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);

module.exports = app;
