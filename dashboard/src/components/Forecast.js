import React, { useState, useEffect, useCallback } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";
import { Line } from "react-chartjs-2";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

const API_URL = process.env.REACT_APP_API_URL || "http://localhost:3002";

const SUPPORTED_SYMBOLS = [
  "RELIANCE",
  "TCS",
  "INFY",
  "HDFCBANK",
  "HINDUNILVR",
  "ITC",
  "SBIN",
  "BHARTIARTL",
  "TATAPOWER",
  "WIPRO",
  "M&M",
  "ONGC",
];

const Forecast = () => {
  const [selectedSymbol, setSelectedSymbol] = useState("RELIANCE");
  const [forecast, setForecast] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchForecast = useCallback(
    async (symbolToFetch = selectedSymbol) => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`${API_URL}/api/predict/${symbolToFetch}`, {
          credentials: "include",
        });

        if (!response.ok) {
          if (response.status === 503) {
            setError(
              "ML forecasting service is currently unavailable. Please ensure the Python ML service is running on port 3003."
            );
          } else if (response.status === 401) {
            setError("Your session has expired. Please log in to view stock forecasts.");
          } else {
            const errorData = await response.json().catch(() => ({}));
            setError(
              errorData.error || "Unable to load stock forecast. Please try again later."
            );
          }
          setForecast(null);
          return;
        }

        const data = await response.json();
        const payload = data?.data || data;
        setForecast(payload);
      } catch (err) {
        setError("Network error. Unable to connect to backend forecasting proxy.");
        setForecast(null);
      } finally {
        setLoading(false);
      }
    },
    [selectedSymbol]
  );

  useEffect(() => {
    fetchForecast(selectedSymbol);
  }, [selectedSymbol, fetchForecast]);

  const handleSymbolChange = (e) => {
    const newSym = e.target.value;
    setSelectedSymbol(newSym);
  };

  // Build chart dataset
  let chartData = null;
  if (forecast && forecast.historical_dates && forecast.historical_prices) {
    const dates = [...forecast.historical_dates, "Forecast (t+1)"];
    const prices = [...forecast.historical_prices, null];
    const forecastPrices = Array(forecast.historical_prices.length - 1).fill(null);
    forecastPrices.push(forecast.last_price);
    forecastPrices.push(forecast.predicted_price);

    chartData = {
      labels: dates,
      datasets: [
        {
          label: "Historical Close (₹)",
          data: prices,
          borderColor: "#387ed1",
          backgroundColor: "rgba(56, 126, 209, 0.08)",
          fill: true,
          tension: 0.15,
          pointRadius: 1,
        },
        {
          label: "Next-Day Prediction (₹)",
          data: forecastPrices,
          borderColor: forecast.predicted_direction === "UP" ? "#4caf50" : "#df514c",
          borderDash: [5, 5],
          pointRadius: [
            ...Array(forecast.historical_prices.length - 1).fill(0),
            3,
            6,
          ],
          pointBackgroundColor:
            forecast.predicted_direction === "UP" ? "#4caf50" : "#df514c",
        },
      ],
    };
  }

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: "top",
      },
      title: {
        display: true,
        text: `${selectedSymbol} — 60-Day Price Trend & Next-Day Forecast`,
      },
    },
    scales: {
      x: {
        ticks: {
          maxTicksLimit: 10,
        },
      },
    },
  };

  const isUp = forecast?.predicted_direction === "UP";

  return (
    <div className="forecast-container" style={{ padding: "20px 30px" }}>
      <div
        className="forecast-header"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "15px",
        }}
      >
        <h3 className="title" style={{ margin: 0 }}>
          AI Forecasting (LSTM Benchmark)
        </h3>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <label htmlFor="symbol-select" style={{ fontWeight: 500, fontSize: "14px" }}>
            Select Stock:
          </label>
          <select
            id="symbol-select"
            value={selectedSymbol}
            onChange={handleSymbolChange}
            style={{
              padding: "6px 12px",
              borderRadius: "4px",
              border: "1px solid #ccc",
              fontSize: "14px",
              fontWeight: 500,
            }}
          >
            {SUPPORTED_SYMBOLS.map((sym) => (
              <option key={sym} value={sym}>
                {sym}
              </option>
            ))}
          </select>
          <button
            onClick={() => fetchForecast(selectedSymbol)}
            style={{
              padding: "6px 14px",
              backgroundColor: "#387ed1",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "13px",
            }}
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Prominent Educational Disclaimer Banner */}
      <div
        className="disclaimer-banner"
        style={{
          backgroundColor: "#fff8e1",
          border: "1px solid #ffe082",
          color: "#795548",
          padding: "10px 15px",
          borderRadius: "4px",
          marginBottom: "20px",
          fontSize: "13px",
          lineHeight: "1.5",
        }}
      >
        <strong>⚠️ Educational & Research Benchmark Only:</strong> This machine learning
        model is strictly an academic benchmark. It does not constitute financial or
        trading advice. Stock price movements in efficient markets are stochastic; naive
        baselines frequently match or exceed deep learning performance.
      </div>

      {loading && (
        <div
          className="loading-state"
          style={{
            padding: "40px",
            textAlign: "center",
            color: "#666",
            fontSize: "15px",
          }}
        >
          Loading forecast for {selectedSymbol}...
        </div>
      )}

      {error && !loading && (
        <div
          className="error-state"
          style={{
            backgroundColor: "#ffebee",
            border: "1px solid #ffcdd2",
            color: "#c62828",
            padding: "15px",
            borderRadius: "4px",
            marginBottom: "20px",
            fontSize: "14px",
          }}
        >
          <p style={{ margin: 0, fontWeight: 500 }}>{error}</p>
        </div>
      )}

      {forecast && !loading && (
        <>
          {/* Key Metrics Cards */}
          <div
            className="metrics-cards"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: "15px",
              marginBottom: "20px",
            }}
          >
            <div
              className="card"
              style={{
                padding: "15px",
                border: "1px solid #eee",
                borderRadius: "6px",
                backgroundColor: "#fafafa",
              }}
            >
              <span style={{ fontSize: "12px", color: "#888" }}>Last Traded Price</span>
              <h4 style={{ margin: "5px 0 0", fontSize: "20px", color: "#333" }}>
                ₹{forecast.last_price.toFixed(2)}
              </h4>
            </div>

            <div
              className="card"
              style={{
                padding: "15px",
                border: "1px solid #eee",
                borderRadius: "6px",
                backgroundColor: "#fafafa",
              }}
            >
              <span style={{ fontSize: "12px", color: "#888" }}>Predicted Next Price</span>
              <h4 style={{ margin: "5px 0 0", fontSize: "20px", color: "#333" }}>
                ₹{forecast.predicted_price.toFixed(2)}
              </h4>
            </div>

            <div
              className="card"
              style={{
                padding: "15px",
                border: "1px solid #eee",
                borderRadius: "6px",
                backgroundColor: isUp ? "#e8f5e9" : "#ffebee",
              }}
            >
              <span style={{ fontSize: "12px", color: "#888" }}>Forecast Direction</span>
              <h4
                style={{
                  margin: "5px 0 0",
                  fontSize: "18px",
                  color: isUp ? "#2e7d32" : "#c62828",
                  fontWeight: 600,
                }}
              >
                {isUp ? "▲ Bullish (UP)" : "▼ Bearish (DOWN)"}
              </h4>
            </div>

            <div
              className="card"
              style={{
                padding: "15px",
                border: "1px solid #eee",
                borderRadius: "6px",
                backgroundColor: "#fafafa",
              }}
            >
              <span style={{ fontSize: "12px", color: "#888" }}>Direction Probability</span>
              <h4 style={{ margin: "5px 0 0", fontSize: "20px", color: "#333" }}>
                {(forecast.direction_probability * 100).toFixed(1)}%
              </h4>
            </div>

            <div
              className="card"
              style={{
                padding: "15px",
                border: "1px solid #eee",
                borderRadius: "6px",
                backgroundColor: "#fafafa",
              }}
            >
              <span style={{ fontSize: "12px", color: "#888" }}>Model Confidence</span>
              <h4 style={{ margin: "5px 0 0", fontSize: "20px", color: "#333" }}>
                {(forecast.confidence_score * 100).toFixed(1)}%
              </h4>
            </div>
          </div>

          {/* Chart Display */}
          <div
            className="chart-wrapper"
            style={{
              height: "360px",
              padding: "15px",
              border: "1px solid #eee",
              borderRadius: "6px",
              backgroundColor: "#fff",
            }}
          >
            {chartData && <Line data={chartData} options={chartOptions} />}
          </div>
        </>
      )}
    </div>
  );
};

export default Forecast;
