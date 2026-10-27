import React, { useEffect, useState } from "react";
import axios from "axios";
import Dashboard from "./Dashboard";
import TopBar from "./TopBar";

const API_URL = process.env.REACT_APP_API_URL || "http://localhost:3002";
const FRONTEND_URL = process.env.REACT_APP_FRONTEND_URL || "http://localhost:3000";

const Home = () => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    axios
      .get(`${API_URL}/me`, { withCredentials: true })
      .then((res) => {
        if (isMounted) {
          if (res.data?.authenticated && res.data?.user) {
            setUser(res.data.user);
            setLoading(false);
          } else {
            window.location.href = `${FRONTEND_URL}/login`;
          }
        }
      })
      .catch((err) => {
        if (isMounted) {
          window.location.href = `${FRONTEND_URL}/login`;
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "100vh",
          fontFamily: "sans-serif",
          color: "#555",
        }}
      >
        <h4>Loading ProfitProfile Dashboard...</h4>
      </div>
    );
  }

  return (
    <>
      <TopBar user={user} />
      <Dashboard />
    </>
  );
};

export default Home;
