import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import Forecast from "../components/Forecast";

jest.mock("react-chartjs-2", () => ({
  Line: () => <div data-testid="mock-line-chart">Chart Rendered</div>,
}));

describe("Forecast Component", () => {
  const mockPayload = {
    symbol: "RELIANCE.NS",
    last_price: 2500.5,
    predicted_direction: "UP",
    direction_probability: 0.5234,
    predicted_return: 0.0045,
    predicted_price: 2511.78,
    confidence_score: 0.0468,
    historical_dates: ["2026-10-21", "2026-10-22", "2026-10-23"],
    historical_prices: [2480.0, 2495.0, 2500.5],
    cached: false,
    disclaimer: "Educational forecast only — not financial advice.",
    timestamp: "2026-10-28T04:00:00Z",
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("renders forecast header, disclaimer banner, and loads prediction data", async () => {
    jest.spyOn(global, "fetch").mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: mockPayload }),
      })
    );

    render(<Forecast />);

    // Header and Disclaimer
    expect(screen.getByText(/AI Forecasting/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Educational & Research Benchmark Only/i)
    ).toBeInTheDocument();

    // Wait for forecast data cards to render
    await waitFor(() => {
      expect(screen.getByText(/₹2500.50/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/₹2511.78/i)).toBeInTheDocument();
    expect(screen.getByText(/Bullish \(UP\)/i)).toBeInTheDocument();
    expect(screen.getByText(/52.3%/i)).toBeInTheDocument();
    expect(screen.getByTestId("mock-line-chart")).toBeInTheDocument();
  });

  test("renders graceful 503 fallback state when ML service is unavailable", async () => {
    jest.spyOn(global, "fetch").mockImplementationOnce(() =>
      Promise.resolve({
        ok: false,
        status: 503,
        json: () =>
          Promise.resolve({
            error: "ML forecasting service is currently unavailable.",
          }),
      })
    );

    render(<Forecast />);

    await waitFor(() => {
      expect(
        screen.getByText(/ML forecasting service is currently unavailable/i)
      ).toBeInTheDocument();
    });
  });
});
