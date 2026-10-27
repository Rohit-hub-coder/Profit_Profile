import React, { useState } from "react";
import { Link } from "react-router-dom";

const API_URL = process.env.REACT_APP_API_URL || "http://localhost:3002";
const DASHBOARD_URL = process.env.REACT_APP_DASHBOARD_URL || "http://localhost:3001";

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");

    if (!email || !password) {
      setError("Please enter both email and password.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });

      const data = await res.json();
      if (res.ok) {
        window.location.href = DASHBOARD_URL;
      } else {
        setError(data.error || "Invalid email or password.");
      }
    } catch (err) {
      setError("Network error. Could not connect to authentication server.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container text-center my-5">
      <h2 className="mb-3 fw-bold" style={{ color: "#0074D9" }}>
        Login to ProfitProfile
      </h2>
      <img
        src="/images/login.png"
        alt="ProfitProfile"
        width="10%"
        className="mb-4"
        style={{ minWidth: "90px" }}
      />
      <div style={{ maxWidth: "420px", margin: "0 auto" }}>
        {error && (
          <div className="alert alert-danger text-start py-2 mb-3" role="alert">
            {error}
          </div>
        )}
        <form onSubmit={handleLogin}>
          <input
            type="email"
            placeholder="Email address"
            className="form-control mb-3"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
          <input
            type="password"
            placeholder="Password"
            className="form-control mb-3"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
          <button
            type="submit"
            className="btn btn-primary w-100 py-2 mb-3"
            disabled={loading}
          >
            {loading ? "Logging in..." : "Login"}
          </button>
        </form>
        <div className="text-muted mt-3">
          Don't have an account?{" "}
          <Link to="/sighnup" style={{ textDecoration: "none", color: "#0074D9" }}>
            Sign up now
          </Link>
        </div>
      </div>
    </div>
  );
}

export default Login;
