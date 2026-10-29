const request = require("supertest");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const app = require("../index");
const { UserModel } = require("../models/users");
const { HoldingsModel } = require("../models/holdings");
const { PosModel } = require("../models/positions");
const { OrdersModel } = require("../models/orders");

let mongoServer;

jest.setTimeout(180000);

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);
}, 180000);

afterAll(async () => {
  if (app.otpCleanupTimer) {
    clearInterval(app.otpCleanupTimer);
  }
  await mongoose.disconnect();
  if (mongoServer) {
    await mongoServer.stop();
  }
});

beforeEach(async () => {
  if (app.otpStore) {
    app.otpStore.clear();
  }
});

describe("OTP Flow & Verification", () => {
  const testEmail = "trader1@example.com";

  test("POST /send-otp fails with 400 on invalid email", async () => {
    const res = await request(app)
      .post("/send-otp")
      .send({ email: "not-an-email" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/valid email/i);
  });

  test("POST /send-otp successfully generates OTP and returns 200", async () => {
    const res = await request(app)
      .post("/send-otp")
      .send({ email: testEmail });

    expect(res.status).toBe(200);
    expect(app.otpStore.has(testEmail)).toBe(true);
    const entry = app.otpStore.get(testEmail);
    expect(entry.otp).toBeDefined();
    expect(entry.otp.length).toBe(6);
  });

  test("POST /send-otp never returns OTP in response body when NODE_ENV=production", async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const res = await request(app)
        .post("/send-otp")
        .send({ email: "prod_check@example.com" });

      expect(res.body.otp).toBeUndefined();
      expect(res.body.devOtp).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toMatch(/devOtp/i);
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  test("POST /send-otp enforces 60-second cooldown rate limit (429)", async () => {
    // First send
    await request(app).post("/send-otp").send({ email: "cooldown@example.com" });

    // Immediate second send
    const secondRes = await request(app)
      .post("/send-otp")
      .send({ email: "cooldown@example.com" });

    expect(secondRes.status).toBe(429);
    expect(secondRes.body.error).toMatch(/wait before requesting/i);
  });

  test("POST /verify-otp rejects invalid/missing email or OTP with 400", async () => {
    const res = await request(app)
      .post("/verify-otp")
      .send({ email: testEmail, otp: "" });

    expect(res.status).toBe(400);
  });

  test("POST /verify-otp increments attempts and fails with 400 on wrong OTP", async () => {
    await request(app).post("/send-otp").send({ email: testEmail });

    const res = await request(app)
      .post("/verify-otp")
      .send({ email: testEmail, otp: "000000" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/incorrect otp/i);
    expect(app.otpStore.get(testEmail).attempts).toBe(1);
  });

  test("POST /verify-otp locks out after 5 failed attempts (429)", async () => {
    await request(app).post("/send-otp").send({ email: testEmail });
    const record = app.otpStore.get(testEmail);
    record.attempts = 5;

    const res = await request(app)
      .post("/verify-otp")
      .send({ email: testEmail, otp: "999999" });

    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/too many wrong attempts/i);
    expect(app.otpStore.has(testEmail)).toBe(false);
  });

  test("POST /verify-otp rejects expired OTP with 400", async () => {
    await request(app).post("/send-otp").send({ email: testEmail });
    const record = app.otpStore.get(testEmail);
    record.expiresAt = Date.now() - 1000; // expired in past

    const res = await request(app)
      .post("/verify-otp")
      .send({ email: testEmail, otp: record.otp });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/otp expired/i);
  });

  test("POST /verify-otp succeeds with correct OTP", async () => {
    await request(app).post("/send-otp").send({ email: testEmail });
    const validOtp = app.otpStore.get(testEmail).otp;

    const res = await request(app)
      .post("/verify-otp")
      .send({ email: testEmail, otp: validOtp });

    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
    expect(app.otpStore.get(testEmail).verified).toBe(true);
  });
});

describe("Authentication (Signup, Login, Logout, Session)", () => {
  const userAEmail = "alice@example.com";
  const userAPassword = "password123";
  let userACookie;

  test("POST /signup rejects unverified email with 400", async () => {
    const res = await request(app)
      .post("/signup")
      .send({ email: userAEmail, password: userAPassword });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/prior to registration/i);
  });

  test("POST /signup registers user, starts session, and seeds mock portfolio", async () => {
    // Stage verified OTP
    await request(app).post("/send-otp").send({ email: userAEmail });
    const otp = app.otpStore.get(userAEmail).otp;
    await request(app).post("/verify-otp").send({ email: userAEmail, otp });

    const res = await request(app)
      .post("/signup")
      .send({ email: userAEmail, password: userAPassword, otp });

    expect(res.status).toBe(201);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.email).toBe(userAEmail);

    // Save session cookie
    userACookie = res.headers["set-cookie"];
    expect(userACookie).toBeDefined();

    // Verify user was seeded with default holdings and positions
    const userDoc = await UserModel.findOne({ email: userAEmail });
    const holdings = await HoldingsModel.find({ user: userDoc._id });
    const positions = await PosModel.find({ user: userDoc._id });
    expect(holdings.length).toBeGreaterThan(0);
    expect(positions.length).toBeGreaterThan(0);
  });

  test("POST /signup rejects duplicate email with 409", async () => {
    app.otpStore.set(userAEmail, {
      otp: "123456",
      expiresAt: Date.now() + 60000,
      attempts: 0,
      lastSent: Date.now(),
      verified: true,
    });

    const res = await request(app)
      .post("/signup")
      .send({ email: userAEmail, password: userAPassword, otp: "123456" });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already exists/i);
  });

  test("POST /login fails with 401 on incorrect password", async () => {
    const res = await request(app)
      .post("/login")
      .send({ email: userAEmail, password: "wrongpassword" });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid email or password/i);
  });

  test("POST /login succeeds with correct credentials", async () => {
    const res = await request(app)
      .post("/login")
      .send({ email: userAEmail, password: userAPassword });

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(userAEmail);
    expect(res.headers["set-cookie"]).toBeDefined();
    userACookie = res.headers["set-cookie"];
  });

  test("GET /me returns user payload when authenticated", async () => {
    const res = await request(app)
      .get("/me")
      .set("Cookie", userACookie);

    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(true);
    expect(res.body.user.email).toBe(userAEmail);
  });

  test("POST /logout destroys session and GET /me returns 401", async () => {
    const logoutRes = await request(app)
      .post("/logout")
      .set("Cookie", userACookie);

    expect(logoutRes.status).toBe(200);

    const meRes = await request(app)
      .get("/me")
      .set("Cookie", userACookie);

    expect(meRes.status).toBe(401);
  });
});

describe("Protected Routes & Multi-Tenant Data Scoping", () => {
  const aliceEmail = "alice_scope@example.com";
  const bobEmail = "bob_scope@example.com";
  const password = "password123";
  let aliceCookie;
  let bobCookie;

  beforeAll(async () => {
    // Setup Alice
    app.otpStore.set(aliceEmail, {
      otp: "111111",
      expiresAt: Date.now() + 60000,
      attempts: 0,
      lastSent: Date.now(),
      verified: true,
    });
    const resA = await request(app)
      .post("/signup")
      .send({ email: aliceEmail, password, otp: "111111" });
    aliceCookie = resA.headers["set-cookie"];

    // Setup Bob
    app.otpStore.set(bobEmail, {
      otp: "222222",
      expiresAt: Date.now() + 60000,
      attempts: 0,
      lastSent: Date.now(),
      verified: true,
    });
    const resB = await request(app)
      .post("/signup")
      .send({ email: bobEmail, password, otp: "222222" });
    bobCookie = resB.headers["set-cookie"];
  }, 60000);

  test("Protected routes return 401 when unauthenticated", async () => {
    const holdingsRes = await request(app).get("/allholdings");
    expect(holdingsRes.status).toBe(401);

    const posRes = await request(app).get("/allpositions");
    expect(posRes.status).toBe(401);

    const ordersRes = await request(app).get("/allorders");
    expect(ordersRes.status).toBe(401);

    const newOrderRes = await request(app)
      .post("/neworder")
      .send({ name: "INFY", qty: 1, price: 1500, mode: "BUY" });
    expect(newOrderRes.status).toBe(401);
  });

  test("POST /neworder validates inputs (positive numbers, valid mode)", async () => {
    // Negative quantity
    const badQty = await request(app)
      .post("/neworder")
      .set("Cookie", aliceCookie)
      .send({ name: "INFY", qty: -5, price: 1500, mode: "BUY" });
    expect(badQty.status).toBe(400);

    // Zero / negative price
    const badPrice = await request(app)
      .post("/neworder")
      .set("Cookie", aliceCookie)
      .send({ name: "INFY", qty: 10, price: 0, mode: "BUY" });
    expect(badPrice.status).toBe(400);

    // Invalid mode
    const badMode = await request(app)
      .post("/neworder")
      .set("Cookie", aliceCookie)
      .send({ name: "INFY", qty: 10, price: 1500, mode: "HOLD" });
    expect(badMode.status).toBe(400);
  });

  test("Order placement is strictly scoped to the authenticated user", async () => {
    // Alice places an order for TCS
    const orderRes = await request(app)
      .post("/neworder")
      .set("Cookie", aliceCookie)
      .send({ name: "TCS", qty: 5, price: 3200, mode: "BUY" });

    expect(orderRes.status).toBe(201);

    // Alice fetches her orders -> TCS order is present
    const aliceOrdersRes = await request(app)
      .get("/allorders")
      .set("Cookie", aliceCookie);

    expect(aliceOrdersRes.status).toBe(200);
    expect(aliceOrdersRes.body.data.length).toBe(1);
    expect(aliceOrdersRes.body.data[0].name).toBe("TCS");
    expect(aliceOrdersRes.body.data[0].qty).toBe(5);

    // Bob fetches his orders -> TCS order placed by Alice is NOT visible to Bob
    const bobOrdersRes = await request(app)
      .get("/allorders")
      .set("Cookie", bobCookie);

    expect(bobOrdersRes.status).toBe(200);
    expect(bobOrdersRes.body.data.length).toBe(0);
  });

  test("Holdings and Positions queries are isolated per user", async () => {
    const aliceHoldings = await request(app)
      .get("/allholdings")
      .set("Cookie", aliceCookie);
    const bobHoldings = await request(app)
      .get("/allholdings")
      .set("Cookie", bobCookie);

    expect(aliceHoldings.status).toBe(200);
    expect(bobHoldings.status).toBe(200);

    // Both have holdings, but their records have distinct ObjectIds
    expect(aliceHoldings.body.data.length).toBeGreaterThan(0);
    expect(bobHoldings.body.data.length).toBeGreaterThan(0);
    expect(aliceHoldings.body.data[0]._id).not.toBe(bobHoldings.body.data[0]._id);
  });
});


describe("ML Forecasting Proxy Endpoint (/api/predict/:symbol)", () => {
  let userCookie;

  beforeAll(async () => {
    const email = "mltestuser@example.com";
    app.otpStore.set(email, {
      otp: "123456",
      expiresAt: Date.now() + 60000,
      attempts: 0,
      lastSent: Date.now(),
      verified: true,
    });
    const signupRes = await request(app)
      .post("/signup")
      .send({ email, password: "Password123!" });
    userCookie = signupRes.headers["set-cookie"];
  });

  test("GET /api/predict/:symbol returns 401 when unauthenticated", async () => {
    const res = await request(app).get("/api/predict/RELIANCE");
    expect(res.status).toBe(401);
  });

  test("GET /api/predict/:symbol returns 400 for unsupported ticker", async () => {
    const res = await request(app)
      .get("/api/predict/NOT_A_STOCK")
      .set("Cookie", userCookie);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unsupported symbol/i);
  });

  test("GET /api/predict/:symbol returns 503 when ML service is unreachable", async () => {
    const originalUrl = process.env.ML_API_URL;
    process.env.ML_API_URL = "http://127.0.0.1:59999";
    const res = await request(app)
      .get("/api/predict/RELIANCE")
      .set("Cookie", userCookie);
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/ML forecasting service is currently unavailable/i);
    process.env.ML_API_URL = originalUrl;
  });

  test("GET /api/predict/:symbol returns 200 when ML service returns forecast", async () => {
    const mockPayload = {
      symbol: "RELIANCE.NS",
      last_price: 2500.0,
      predicted_direction: "UP",
      direction_probability: 0.54,
      predicted_return: 0.005,
      predicted_price: 2512.5,
      confidence_score: 0.08,
      historical_dates: ["2026-10-22", "2026-10-23"],
      historical_prices: [2490.0, 2500.0],
      cached: false,
      disclaimer: "Educational forecast only — not financial advice.",
      timestamp: new Date().toISOString(),
    };

    const fetchSpy = jest.spyOn(global, "fetch").mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockPayload),
      })
    );

    const res = await request(app)
      .get("/api/predict/RELIANCE")
      .set("Cookie", userCookie);

    expect(res.status).toBe(200);
    expect(res.body.data.symbol).toBe("RELIANCE.NS");
    expect(res.body.data.predicted_direction).toBe("UP");
    expect(res.body.data.predicted_price).toBe(2512.5);

    fetchSpy.mockRestore();
  });
});
