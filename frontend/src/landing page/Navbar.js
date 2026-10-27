import React from "react";
import { Link } from "react-router-dom";

function Navbar() {
  return (
    <nav
      className="navbar navbar-expand-lg sticky-top bg-body-tertiary border-bottom"
      style={{ backgroundColor: "#424242" }}
    >
      <div className="container p-2">
        <Link className="navbar-brand" to={"/"}>
          <img
            src="/images/ProfitProfile.png"
            alt="ProfitProfile"
            style={{ width: "160px" }}
          />
        </Link>
        <button
          className="navbar-toggler"
          type="button"
          data-bs-toggle="collapse"
          data-bs-target="#navbarSupportedContent"
          aria-controls="navbarSupportedContent"
          aria-expanded="false"
          aria-label="Toggle navigation"
        >
          <span className="navbar-toggler-icon"></span>
        </button>
        <div className="collapse navbar-collapse" id="navbarSupportedContent">
          <ul className="navbar-nav ms-auto mb-2 mb-lg-0 align-items-center">
            <li className="nav-item">
              <Link className="nav-link" to={"/sighnup"}>
                Signup
              </Link>
            </li>
            <li className="nav-item">
              <Link className="nav-link" to={"/login"}>
                Login
              </Link>
            </li>
            <li className="nav-item">
              <Link className="nav-link" to={"/about"}>
                About
              </Link>
            </li>
            <li className="nav-item">
              <Link className="nav-link" to={"/products"}>
                Products
              </Link>
            </li>
            <li className="nav-item">
              <Link className="nav-link" to={"/pricing"}>
                Pricing
              </Link>
            </li>
            <li className="nav-item">
              <Link className="nav-link" to={"/support"}>
                Support
              </Link>
            </li>
            <li className="nav-item ms-lg-3">
              <a
                className="btn btn-outline-primary fw-semibold"
                href="http://localhost:3003"
                title="Open Trading Dashboard"
              >
                Dashboard ↗
              </a>
            </li>
          </ul>
        </div>
      </div>
    </nav>
  );
}

export default Navbar;
