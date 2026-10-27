import React, { useState } from "react";

function Login() {
  const [useOtp, setUseOtp] = useState(false);
  const [email, setEmail] = useState("");
  const [passwordOrOtp, setPasswordOrOtp] = useState("");

  const handleOtpToggle = () => {
    setUseOtp(true);
    setPasswordOrOtp(""); // clear the input
  };

  const handleLogin = (e) => {
    e.preventDefault();
    // Redirect directly to the Trading Dashboard on port 3003
    window.location.href = "http://localhost:3003";
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
      />
      <form onSubmit={handleLogin} style={{ width: "30%", marginLeft: "35%" }}>
        <input
          type="email"
          placeholder="Email address"
          className="form-control mb-3"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          type={useOtp ? "text" : "password"}
          placeholder={useOtp ? "Enter OTP" : "Password"}
          className="form-control mb-3"
          value={passwordOrOtp}
          onChange={(e) => setPasswordOrOtp(e.target.value)}
          required
        />
        {!useOtp && (
          <div className="form-check text-start mb-3">
            <input type="checkbox" className="form-check-input" id="remember" />
            <label className="form-check-label" htmlFor="remember">
              Remember my Credentials
            </label>
          </div>
        )}
        <div className="d-flex justify-content-center gap-2">
          <button type="submit" className="btn btn-primary">
            Login to Dashboard
          </button>
          {!useOtp && (
            <button
              type="button"
              className="btn btn-outline-primary"
              onClick={handleOtpToggle}
            >
              Login using OTP
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

export default Login;
