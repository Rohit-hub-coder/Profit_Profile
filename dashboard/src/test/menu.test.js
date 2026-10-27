import React from "react";
import { render, screen } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import "@testing-library/jest-dom";
import Menu from "../components/Menu";

describe("Menu Component", () => {
  test("renders all navigation menu items", () => {
    render(
      <BrowserRouter>
        <Menu />
      </BrowserRouter>
    );

    expect(screen.getByText(/Dashboard/i)).toBeInTheDocument();
    expect(screen.getByText(/Orders/i)).toBeInTheDocument();
    expect(screen.getByText(/Holdings/i)).toBeInTheDocument();
    expect(screen.getByText(/Positions/i)).toBeInTheDocument();
    expect(screen.getByText(/Funds/i)).toBeInTheDocument();
    expect(screen.getByText(/Apps/i)).toBeInTheDocument();
  });
});
