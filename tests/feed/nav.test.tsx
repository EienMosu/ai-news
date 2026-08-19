// @vitest-environment jsdom
//
// Opt-in per file -- see the docblock in tests/feed/card.test.tsx for why: this file needs a
// DOM and explicit `afterEach(cleanup)` because `test.globals` is false project-wide.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SectionNav } from "../../components/SectionNav.js";

afterEach(cleanup);

describe("SectionNav", () => {
  it("renders both section links with the right hrefs", () => {
    render(<SectionNav current={null} />);
    expect(screen.getByRole("link", { name: "AI" }).getAttribute("href")).toBe("/");
    expect(screen.getByRole("link", { name: "Design" }).getAttribute("href")).toBe("/design");
  });

  it("marks the AI link current via aria-current when current is 'ai'", () => {
    render(<SectionNav current="ai" />);
    expect(screen.getByRole("link", { name: "AI" }).getAttribute("aria-current")).toBe("page");
  });

  it("does not mark the Design link current when current is 'ai'", () => {
    render(<SectionNav current="ai" />);
    expect(screen.getByRole("link", { name: "Design" }).getAttribute("aria-current")).toBeNull();
  });

  it("marks the Design link current via aria-current when current is 'design'", () => {
    render(<SectionNav current="design" />);
    expect(screen.getByRole("link", { name: "Design" }).getAttribute("aria-current")).toBe("page");
  });

  it("does not mark the AI link current when current is 'design'", () => {
    render(<SectionNav current="design" />);
    expect(screen.getByRole("link", { name: "AI" }).getAttribute("aria-current")).toBeNull();
  });

  it("marks neither link current when current is null", () => {
    render(<SectionNav current={null} />);
    expect(screen.getByRole("link", { name: "AI" }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("link", { name: "Design" }).getAttribute("aria-current")).toBeNull();
  });
});
