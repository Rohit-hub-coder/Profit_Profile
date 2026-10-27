import React from "react";
import { render, screen } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import "@testing-library/jest-dom";

jest.mock("axios", () => ({
  post: jest.fn().mockResolvedValue({ data: {} }),
  get: jest.fn().mockResolvedValue({ data: {} }),
  defaults: { withCredentials: true },
}));

import TopBar from "../components/TopBar";

describe("TopBar Component", () => {
  test("renders market indices and user details", () => {
    const mockUser = { id: "123", email: "trader@example.com" };

    render(
      <BrowserRouter>
        <TopBar user={mockUser} />
      </BrowserRouter>
    );

    expect(screen.getByText(/NIFTY 50/i)).toBeInTheDocument();
    expect(screen.getByText(/SENSEX/i)).toBeInTheDocument();
    expect(screen.getByText("trader@example.com")).toBeInTheDocument();
    expect(screen.getByText("TR")).toBeInTheDocument();
  });
});
