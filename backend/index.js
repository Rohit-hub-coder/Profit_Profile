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

// Fail-fast if SESSION_SECRET is missing (allows mock secret in test mode)
if (!process.env.SESSION_SECRET) {
  if (process.env.NODE_ENV === "test") {
    process.env.SESSION_SECRET = "test_environment_session_secret_32_chars";
  } else {
    process.stderr.write("FATAL: SESSION_SECRET environment variable is missing.\n");
    process.exit(1);
  }
}

const port = process.env.PORT || 3002;
const url = process.env.MONGO_URL || "mongodb://localhost:27017/profitprofile";

const { HoldingsModel } = require("./models/holdings");
const { PosModel } = require("./models/positions");
const { OrdersModel } = require("./models/orders");
const { UserModel } = require("./models/users");

// In-memory OTP store: email -> { otp, expiresAt, attempts, lastSent, verified }
const otpStore = new Map();

const app = express();

// Security headers
app.use(helmet());

// CORS allowlist configuration (no wildcard)
const defaultAllowedOrigins = [
  "http://localhost:3000",
  "http://localhost:3001",
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

passport.use(new LocalStrategy({ usernameField: "email" }, UserModel.authenticate()));
passport.serializeUser(UserModel.serializeUser());
passport.deserializeUser(UserModel.deserializeUser());

// Rate limiters
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many authentication attempts, please try again later." },
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

// Default mock data seeded for each newly created user account
const defaultHoldings = [
  { name: "BHARTIARTL", qty: 2, avg: 538.05, price: 541.15, net: "+0.58%", day: "+2.99%", isLoss: false },
  { name: "HDFCBANK", qty: 2, avg: 1383.4, price: 1522.35, net: "+10.04%", day: "+0.11%", isLoss: false },
  { name: "HINDUNILVR", qty: 1, avg: 2335.85, price: 2417.4, net: "+3.49%", day: "+0.21%", isLoss: false },
  { name: "INFY", qty: 1, avg: 1350.5, price: 1555.45, net: "+15.18%", day: "-1.60%", isLoss: true },
  { name: "ITC", qty: 5, avg: 202.0, price: 207.9, net: "+2.92%", day: "+0.80%", isLoss: false },
  { name: "KPITTECH", qty: 5, avg: 250.3, price: 266.45, net: "+6.45%", day: "+3.54%", isLoss: false },
  { name: "M&M", qty: 2, avg: 809.9, price: 779.8, net: "-3.72%", day: "-0.01%", isLoss: true },
  { name: "RELIANCE", qty: 1, avg: 2193.7, price: 2112.4, net: "-3.71%", day: "+1.44%", isLoss: false },
  { name: "SBIN", qty: 4, avg: 324.35, price: 430.2, net: "+32.63%", day: "-0.34%", isLoss: true },
  { name: "SGBMAY29", qty: 2, avg: 4727.0, price: 4719.0, net: "-0.17%", day: "+0.15%", isLoss: false },
  { name: "TATAPOWER", qty: 5, avg: 104.2, price: 124.15, net: "+19.15%", day: "-0.24%", isLoss: true },
  { name: "TCS", qty: 1, avg: 3041.7, price: 3194.8, net: "+5.03%", day: "-0.25%", isLoss: true },
  { name: "WIPRO", qty: 4, avg: 489.3, price: 577.75, net: "+18.08%", day: "+0.32%", isLoss: false },
];

const defaultPositions = [
  { product: "CNC", name: "EVEREADY", qty: 2, avg: 316.27, price: 312.35, net: "+0.58%", day: "-1.24%", isLoss: true },
  { product: "CNC", name: "JUBLFOOD", qty: 1, avg: 3124.75, price: 3082.65, net: "+10.04%", day: "-1.35%", isLoss: true },
];

async function seedUserMockData(userId) {
  const userHoldings = defaultHoldings.map((h) => ({ ...h, user: userId }));
  const userPositions = defaultPositions.map((p) => ({ ...p, user: userId }));
  await HoldingsModel.insertMany(userHoldings);
  await PosModel.insertMany(userPositions);
}

// Auth guard middleware
function requireAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }
  return res.status(401).json({ error: "Unauthorized. Please log in." });
}

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

// Authentication routes
app.post("/signup", authLimiter, async (req, res, next) => {
  try {
    const rawEmail = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const rawPassword = typeof req.body?.password === "string" ? req.body.password : "";
    const rawOtp = typeof req.body?.otp === "string" ? req.body.otp.trim() : "";

    if (!rawEmail || !validator.isEmail(rawEmail)) {
      return res.status(400).json({ error: "Valid email is required" });
    }
    if (!rawPassword || rawPassword.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    const email = validator.normalizeEmail(rawEmail) || rawEmail;

    // Check OTP verification
    const record = otpStore.get(email);
    if (!record || !record.verified) {
      if (rawOtp && record && rawOtp === record.otp) {
        record.verified = true;
      } else {
        return res.status(400).json({ error: "Email must be verified via OTP prior to registration" });
      }
    }

    const existingUser = await UserModel.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }

    const newUser = new UserModel({ email });
    const registeredUser = await UserModel.register(newUser, rawPassword);

    // Clean up OTP state
    otpStore.delete(email);

    // Seed newly registered user with default mock portfolio
    await seedUserMockData(registeredUser._id);

    req.login(registeredUser, (err) => {
      if (err) return next(err);
      return res.status(201).json({
        message: "Account created successfully",
        user: { id: registeredUser._id, email: registeredUser.email },
      });
    });
  } catch (err) {
    next(err);
  }
});

app.post("/login", authLimiter, (req, res, next) => {
  const rawEmail = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const rawPassword = typeof req.body?.password === "string" ? req.body.password : "";

  if (!rawEmail || !rawPassword) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  passport.authenticate("local", (err, user) => {
    if (err) return next(err);
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    req.login(user, (loginErr) => {
      if (loginErr) return next(loginErr);
      return res.json({
        message: "Login successful",
        user: { id: user._id, email: user.email },
      });
    });
  })(req, res, next);
});

app.post("/logout", (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    if (req.session) {
      req.session.destroy(() => {
        res.clearCookie("connect.sid");
        res.json({ message: "Logged out successfully" });
      });
    } else {
      res.json({ message: "Logged out successfully" });
    }
  });
});

app.get("/me", (req, res) => {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return res.json({
      authenticated: true,
      user: { id: req.user._id, email: req.user.email },
    });
  }
  return res.status(401).json({ authenticated: false, error: "Not authenticated" });
});

// Protected data routes scoped to req.user
app.get("/allholdings", requireAuth, async (req, res, next) => {
  try {
    const allholdings = await HoldingsModel.find({ user: req.user._id });
    res.json({ data: allholdings });
  } catch (err) {
    next(err);
  }
});

app.get("/allpositions", requireAuth, async (req, res, next) => {
  try {
    const allpositions = await PosModel.find({ user: req.user._id });
    res.json({ data: allpositions });
  } catch (err) {
    next(err);
  }
});

app.get(["/allorders", "/allOrders"], requireAuth, async (req, res, next) => {
  try {
    const allorders = await OrdersModel.find({ user: req.user._id }).sort({ _id: -1 });
    res.json({ data: allorders });
  } catch (err) {
    next(err);
  }
});

app.post(["/neworder", "/newOrder"], requireAuth, async (req, res, next) => {
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
      user: req.user._id,
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
      verified: false,
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
      // In development / test fallback, allow test OTP without crashing
      if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") {
        res.status(200).json({ message: "OTP sent (dev fallback)", devOtp: otp });
      } else {
        res.status(500).json({ error: "Failed to deliver OTP email. Please verify SMTP configuration." });
      }
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

    record.verified = true;
    res.status(200).json({ verified: true, message: "OTP verified" });
  } catch (err) {
    res.status(500).json({ error: "Verification failed" });
  }
});

// Centralized error handler
app.use((err, req, res, next) => {
  const status = typeof err.status === "number" ? err.status : 500;
  const message = status === 500 ? "Internal server error" : err.message;
  res.status(status).json({ error: message });
});

// Database connection & Graceful Shutdown
let server;
if (process.env.NODE_ENV !== "test") {
  mongoose
    .connect(url)
    .catch((err) => {
      process.stderr.write(`Mongo connection error: ${err.message}\n`);
    });

  server = app.listen(port, () => {});

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
}

app.otpStore = otpStore;
app.otpCleanupTimer = otpCleanupTimer;

module.exports = app;
