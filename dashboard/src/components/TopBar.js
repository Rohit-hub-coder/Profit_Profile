import React, { useState } from "react";
import axios from "axios";
import Menu from "./Menu";

const API_URL = process.env.REACT_APP_API_URL || "http://localhost:3002";
const FRONTEND_URL = process.env.REACT_APP_FRONTEND_URL || "http://localhost:3000";

const TopBar = ({ user }) => {
  const [profileOpen, setProfileOpen] = useState(false);
  const toggleProfile = () => {
    setProfileOpen(!profileOpen);
  };

  const handleLogout = async () => {
    try {
      await axios.post(`${API_URL}/logout`, {}, { withCredentials: true });
    } catch (err) {
      // ignore
    } finally {
      window.location.href = `${FRONTEND_URL}/login`;
    }
  };

  const userInitial = user?.email ? user.email.slice(0, 2).toUpperCase() : "PP";
  const userDisplay = user?.email || "USERID";

  return (
    <div className="topbar-container">
      <Menu />

      <div className="indices-container">
        <div className="nifty">
          <p className="index">NIFTY 50</p>
          <p className="index-points">{100.2} </p>
          <p className="percent"> </p>
        </div>
        <div className="sensex">
          <p className="index">SENSEX</p>
          <p className="index-points">{100.2}</p>
          <p className="percent"></p>
        </div>
        <div
          className="profile"
          onClick={toggleProfile}
          style={{ position: "relative", cursor: "pointer" }}
        >
          <div className="avatar">{userInitial}</div>
          <p className="username">{userDisplay}</p>
          {profileOpen && (
            <div
              style={{
                position: "absolute",
                top: "45px",
                right: "0px",
                backgroundColor: "#fff",
                border: "1px solid #ddd",
                boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                borderRadius: "6px",
                padding: "8px 16px",
                zIndex: 1000,
                minWidth: "120px",
                textAlign: "center",
              }}
            >
              <button
                type="button"
                onClick={handleLogout}
                style={{
                  background: "none",
                  border: "none",
                  color: "#d9534f",
                  fontWeight: "bold",
                  cursor: "pointer",
                  fontSize: "14px",
                  padding: "4px 8px",
                  width: "100%",
                }}
              >
                Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TopBar;
