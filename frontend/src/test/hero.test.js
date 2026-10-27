import React from "react";
import { render, screen } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import "@testing-library/jest-dom";
import Hero from "../landing page/home/Hero";

describe("Hero Component", () => {
  test("renders Hero Image and signup call to action", () => {
    render(
      <BrowserRouter>
        <Hero />
      </BrowserRouter>
    );
    const heroImage = screen.getByAltText("Hero");
    expect(heroImage).toBeInTheDocument();
    expect(heroImage).toHaveAttribute("src", "images/homeHero.png");

    const signupButton = screen.getByRole("button", { name: /signup now/i });
    expect(signupButton).toBeInTheDocument();
  });
});
