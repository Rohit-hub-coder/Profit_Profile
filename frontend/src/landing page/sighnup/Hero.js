import React, { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";

const API_URL = process.env.REACT_APP_API_URL || "http://localhost:3002";
const DASHBOARD_URL = process.env.REACT_APP_DASHBOARD_URL || "http://localhost:3001";

function HeroSignup() {
  const [email, setEmail] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState("");
  const [statusType, setStatusType] = useState("info");
  const [countdown, setCountdown] = useState(0);
  const countdownRef = useRef(null);
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);
  const [sending, setSending] = useState(false);
  const [signingUp, setSigningUp] = useState(false);

  useEffect(() => {
    if (otpSent && countdown === 0 && !verified) {
      setCountdown(300); // 5 minutes
    }
  }, [otpSent, verified]);

  useEffect(() => {
    if (countdown <= 0) {
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
      return;
    }
    if (!countdownRef.current) {
      countdownRef.current = setInterval(() => {
        setCountdown((c) => Math.max(0, c - 1));
      }, 1000);
    }
    return () => {
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
    };
  }, [countdown]);

  const formatTime = (secs) => {
    const m = Math.floor(secs / 60)
      .toString()
      .padStart(2, "0");
    const s = (secs % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  const sendOtp = async () => {
    setStatus("");
    setStatusType("info");
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      setStatus("Please enter a valid email address.");
      setStatusType("danger");
      return false;
    }
    setSending(true);
    try {
      const res = await fetch(`${API_URL}/send-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (res.ok) {
        setOtpSent(true);
        setStatus("OTP sent to " + email);
        setStatusType("success");
        setVerified(false);
        setOtp("");
        return true;
      } else {
        setStatus(data.error || "Failed to send OTP.");
        setStatusType("danger");
        return false;
      }
    } catch (err) {
      setStatus("Network error when sending OTP.");
      setStatusType("danger");
      return false;
    } finally {
      setSending(false);
    }
  };

  const handleButtonClick = async (e) => {
    e.preventDefault();
    await sendOtp();
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    setStatus("");
    if (!otp || otp.trim().length === 0) {
      setStatus("Please enter the 6-digit OTP.");
      setStatusType("danger");
      return;
    }
    if (countdown === 0) {
      setStatus("OTP expired. Please request a new one.");
      setStatusType("danger");
      return;
    }
    setVerifying(true);
    try {
      const res = await fetch(`${API_URL}/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, otp: otp.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.verified) {
        setVerified(true);
        setStatus("Email verified! Now create a password to finish setup.");
        setStatusType("success");
      } else {
        setStatus(data.error || "Invalid OTP.");
        setStatusType("danger");
      }
    } catch (err) {
      setStatus("Network error during verification.");
      setStatusType("danger");
    } finally {
      setVerifying(false);
    }
  };

  const handleCompleteSignup = async (e) => {
    e.preventDefault();
    setStatus("");
    if (!password || password.length < 6) {
      setStatus("Password must be at least 6 characters long.");
      setStatusType("danger");
      return;
    }
    if (password !== confirmPassword) {
      setStatus("Passwords do not match.");
      setStatusType("danger");
      return;
    }

    setSigningUp(true);
    try {
      const res = await fetch(`${API_URL}/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password, otp }),
      });
      const data = await res.json();
      if (res.ok) {
        setStatus("Account created! Redirecting to dashboard...");
        setStatusType("success");
        setTimeout(() => {
          window.location.href = DASHBOARD_URL;
        }, 800);
      } else {
        setStatus(data.error || "Signup failed. Please try again.");
        setStatusType("danger");
      }
    } catch (err) {
      setStatus("Network error during registration.");
      setStatusType("danger");
    } finally {
      setSigningUp(false);
    }
  };

  const handleResend = async () => {
    if (countdown > 0) return;
    setOtpSent(false);
    await sendOtp();
  };

  return (
    <div className="container">
      <div className="p-3 mt-5 mb-5">
        <h3 className="text-center mb-4">
          Open a free demat and trading account online
        </h3>
        <h5 className="text-center text-muted">
          Start investing brokerage free and join a community of investors and traders
        </h5>
      </div>
      <div className="row mt-5 p-3">
        <div className="col-12 col-md-5 mb-4 text-center">
          <img
            src="/images/account_open.svg"
            alt="Signup"
            style={{ maxWidth: "80%", height: "auto" }}
          />
        </div>
        <div className="col-12 col-md-6 offset-md-1">
          <div style={{ maxWidth: "420px" }}>
            <h3 className="pt-2">Signup Now</h3>
            <h5 className="text-muted mb-4">Or create your new trading account</h5>

            {status && (
              <div
                className={`alert alert-${statusType === "danger" ? "danger" : "success"} py-2 mb-3`}
                role="alert"
              >
                <small>{status}</small>
              </div>
            )}

            {!otpSent && (
              <form onSubmit={handleButtonClick}>
                <label className="form-label" htmlFor="email-input">
                  Email address
                </label>
                <input
                  id="email-input"
                  type="email"
                  placeholder="name@example.com"
                  className="form-control mb-3"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
                <button
                  type="submit"
                  className="btn btn-primary w-100 py-2"
                  disabled={sending}
                >
                  {sending ? "Sending OTP..." : "Get OTP"}
                </button>
              </form>
            )}

            {otpSent && !verified && (
              <form onSubmit={handleVerifyOtp}>
                <div className="mb-3">
                  <label className="form-label" htmlFor="otp">
                    Enter the 6-digit OTP sent to <strong>{email}</strong>
                  </label>
                  <input
                    id="otp"
                    placeholder="Enter 6-digit OTP"
                    className="form-control"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value)}
                    maxLength={6}
                    required
                  />
                  <div className="mt-2">
                    <small className="text-muted">
                      OTP expires in: {formatTime(countdown)}{" "}
                      {countdown === 0 && (
                        <span className="text-danger fw-bold"> (expired)</span>
                      )}
                    </small>
                    {countdown === 0 && (
                      <div>
                        <button
                          type="button"
                          className="btn btn-link p-0 text-decoration-none"
                          onClick={handleResend}
                        >
                          Resend OTP
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                <button
                  type="submit"
                  className="btn btn-success w-100 py-2 mb-3"
                  disabled={verifying}
                >
                  {verifying ? "Verifying..." : "Verify OTP"}
                </button>
              </form>
            )}

            {verified && (
              <form onSubmit={handleCompleteSignup}>
                <div className="mb-3">
                  <label className="form-label" htmlFor="new-password">
                    Create Password
                  </label>
                  <input
                    id="new-password"
                    type="password"
                    placeholder="At least 6 characters"
                    className="form-control mb-2"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    minLength={6}
                    required
                  />
                  <label className="form-label" htmlFor="confirm-password">
                    Confirm Password
                  </label>
                  <input
                    id="confirm-password"
                    type="password"
                    placeholder="Re-enter password"
                    className="form-control"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    minLength={6}
                    required
                  />
                </div>
                <button
                  type="submit"
                  className="btn btn-primary w-100 py-2 mb-3"
                  disabled={signingUp}
                >
                  {signingUp ? "Creating Account..." : "Create Account & Go to Dashboard"}
                </button>
              </form>
            )}

            <div className="mt-3 text-muted">
              Already have an account?{" "}
              <Link to="/login" style={{ textDecoration: "none", color: "#0074D9" }}>
                Login here
              </Link>
            </div>

            <p className="mt-4 text-muted small">
              By proceeding, you agree to the ProfitProfile{" "}
              <a href="#terms" style={{ textDecoration: "none" }}>
                terms
              </a>{" "}
              &{" "}
              <a href="#privacy" style={{ textDecoration: "none" }}>
                privacy policy
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default HeroSignup;
