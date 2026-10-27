require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const passport = require("passport");
const LocalStrategy = require("passport-local");
const session = require("express-session");
const bodyParser = require("body-parser");
const nodemailer = require("nodemailer");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const validator = require("validator");

const port = process.env.PORT || 3001;
const url = process.env.MONGO_URL || "mongodb://localhost:27017/profitprofile";

const { HoldingsModel } = require("./models/holdings");
const { PosModel } = require("./models/positions");
const { OrdersModel } = require("./models/orders");
const { UserModel } = require("./models/users");

// In-memory store; replace with Redis in prod
const otpStore = new Map(); // key: email -> { otp, expiresAt, attempts, lastSent }

const app = express();

// CORS: allow local development origins and credentials
app.use(
  cors({
    origin: true,
    credentials: true,
    optionsSuccessStatus: 200,
  })
);

app.use(bodyParser.json());

app.use(
  session({
    secret: process.env.SESSION_SECRET || "Secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production", // true only over HTTPS
      httpOnly: true,
      sameSite: "lax",
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());

passport.use(new LocalStrategy(UserModel.authenticate()));
passport.serializeUser(UserModel.serializeUser());
passport.deserializeUser(UserModel.deserializeUser());

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

async function seedDatabaseIfEmpty() {
  try {
    const holdingsCount = await HoldingsModel.countDocuments();
    if (holdingsCount === 0) {
      await HoldingsModel.insertMany(defaultHoldings);
      console.log(`Seeded ${defaultHoldings.length} initial holdings.`);
    }
    const positionsCount = await PosModel.countDocuments();
    if (positionsCount === 0) {
      await PosModel.insertMany(defaultPositions);
      console.log(`Seeded ${defaultPositions.length} initial positions.`);
    }
  } catch (err) {
    console.error("Error during initial data seeding:", err);
  }
}

// Connect to MongoDB
mongoose
  .connect(url)
  .then(() => {
    console.log("Connected to MongoDB");
    seedDatabaseIfEmpty();
  })
  .catch((err) => {
    console.error("Mongo connection error:", err);
    process.exit(1);
  });

// Basic rate limiter for OTP sending: max 30 per hour per IP (relaxed for dev)
const sendOtpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many OTP requests from this IP, try again later." },
});

// Utility
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Nodemailer transporter
const transporter = nodemailer.createTransport({
  service: "Gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Clean up expired OTPs periodically
setInterval(() => {
  const now = Date.now();
  for (const [email, record] of otpStore.entries()) {
    if (record.expiresAt <= now) {
      otpStore.delete(email);
    }
  }
}, 60 * 1000);

// Routes
app.get("/allholdings", async (req, res) => {
  try {
    const allholdings = await HoldingsModel.find({});
    res.json({ data: allholdings });
  } catch (err) {
    console.error("Error fetching holdings:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/allpositions", async (req, res) => {
  try {
    const allpositions = await PosModel.find({});
    res.json({ data: allpositions });
  } catch (err) {
    console.error("Error fetching positions:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get(["/allorders", "/allOrders"], async (req, res) => {
  try {
    const allorders = await OrdersModel.find({}).sort({ _id: -1 });
    res.json({ data: allorders });
  } catch (err) {
    console.error("Error fetching orders:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post(["/neworder", "/newOrder"], async (req, res) => {
  try {
    const { name, qty, price, mode } = req.body;
    if (!name || !qty || !price || !mode) {
      return res.status(400).json({ error: "Missing order fields" });
    }
    const newOrder = new OrdersModel({
      name,
      qty: Number(qty),
      price: Number(price),
      mode,
    });
    await newOrder.save();
    res.status(201).json({ message: "Order created", order: newOrder });
  } catch (err) {
    console.error("Error creating order:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/send-otp", sendOtpLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !validator.isEmail(email)) {
      return res.status(400).json({ error: "Invalid email" });
    }

    const now = Date.now();
    const existing = otpStore.get(email);
    if (existing) {
      if (now - existing.lastSent < 10 * 1000) {
        return res
          .status(429)
          .json({ error: "Please wait a moment before requesting another OTP." });
      }
    }

    const otp = generateOTP();
    const expiresAt = now + 5 * 60 * 1000; // 5 minutes
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
      res.status(200).json({ message: "OTP sent to " + email });
    } catch (mailErr) {
      console.warn("Note: Nodemailer failed (Gmail App Password required). Falling back to local dev mode.");
      console.log(`\n========================================`);
      console.log(`[LOCAL DEV MODE] Generated OTP for ${email}: ${otp}`);
      console.log(`========================================\n`);
      res.status(200).json({
        message: "OTP sent (Dev mode active: see console)",
        devOtp: otp,
      });
    }
  } catch (err) {
    console.error("Error in send-otp:", err);
    res.status(500).json({ error: "Failed to send OTP" });
  }
});

app.post("/verify-otp", (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ error: "Missing email or OTP" });
    }
    if (!validator.isEmail(email)) {
      return res.status(400).json({ error: "Invalid email" });
    }

    const record = otpStore.get(email);
    if (!record) {
      return res
        .status(400)
        .json({ error: "No OTP requested for this account." });
    }

    const now = Date.now();
    if (now > record.expiresAt) {
      otpStore.delete(email);
      return res.status(400).json({ error: "OTP expired" });
    }

    if (record.attempts >= 5) {
      return res
        .status(429)
        .json({ error: "Too many wrong attempts. Request a new OTP." });
    }

    if (otp.trim() !== record.otp) {
      record.attempts += 1;
      otpStore.set(email, record);
      return res.status(400).json({ error: "Incorrect OTP" });
    }

    otpStore.delete(email); // one-time use
    res.status(200).json({ verified: true, message: "OTP verified" });
  } catch (err) {
    console.error("Error in verify-otp:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
