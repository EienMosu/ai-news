// @vitest-environment jsdom
//
// Opt-in per file -- see the docblock in tests/feed/card.test.tsx for why: this file needs a
// DOM and explicit `afterEach(cleanup)` because `test.globals` is false project-wide.
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SECTION_LABEL, SectionNav } from "../../components/SectionNav.js";
import { SECTIONS } from "../../src/types/article.js";
import { DEFAULT_ARCHIVE_DAYS } from "../../src/lib/feed/days.js";

afterEach(cleanup);

const TAGLINE = "Each day’s news, ranked by importance, not recency.";

describe("SectionNav", () => {
  describe("the masthead block", () => {
    it("renders the wordmark 'The Slow Wire'", () => {
      render(<SectionNav current={null} />);
      expect(screen.getByText("The Slow Wire")).toBeTruthy();
    });

    it("renders the masthead as the page's <h1> when asHeading is true (the default)", () => {
      render(<SectionNav current={null} />);
      const heading = screen.getByRole("heading", { level: 1 });
      expect(heading.textContent).toBe("The Slow Wire");
    });

    it("renders the masthead as a <p>, not a heading, when asHeading is false", () => {
      render(<SectionNav current={null} asHeading={false} />);
      expect(screen.queryByRole("heading")).toBeNull();
      expect(screen.getByText("The Slow Wire")).toBeTruthy();
    });

    it("centers the masthead and sets it in the display face (Modern Classic: the title sits mid-page like a newspaper nameplate, in --font-display which is now Playfair)", () => {
      render(<SectionNav current={null} />);
      const heading = screen.getByRole("heading", { level: 1 });
      expect(heading.className).toContain("text-center");
      expect(heading.className).toContain("font-[family-name:var(--font-display)]");
    });

    it("renders the masthead as plain text -- the old brand-mark svg is retired, so the wordmark carries the identity alone", () => {
      render(<SectionNav current={null} />);
      const heading = screen.getByRole("heading", { level: 1 });
      expect(heading.querySelector("svg")).toBeNull();
    });
  });

  describe("the subline under the masthead", () => {
    it("renders the passed subline verbatim (the feeds pass the day and its count)", () => {
      render(<SectionNav current="ai" subline="26.08.2026 · 99 stories" />);
      expect(screen.getByTestId("tagline").textContent).toBe("26.08.2026 · 99 stories");
    });

    it("falls back to the exact apparatus tagline when no subline is passed (pages that belong to no day)", () => {
      render(<SectionNav current={null} />);
      expect(screen.getByTestId("tagline").textContent).toBe(TAGLINE);
    });
  });

  describe("the util row", () => {
    it("states the product's claim, 'Ranked by importance', on the left", () => {
      render(<SectionNav current={null} />);
      expect(screen.getByText("Ranked by importance")).toBeTruthy();
    });

    it("renders the theme toggle as a <button data-theme-toggle> with the .theme-toggle class -- layout.tsx's inline script finds it by that attribute, and the class carries the CSS that picks which label shows", () => {
      const { container } = render(<SectionNav current={null} />);
      const toggle = container.querySelector("button[data-theme-toggle]");
      expect(toggle).not.toBeNull();
      expect(toggle?.className).toContain("theme-toggle");
    });

    it("ships BOTH labels, Dark and Light, inside the toggle -- CSS shows the right one per theme, so the button is honest before any script runs", () => {
      const { container } = render(<SectionNav current={null} />);
      const toggle = container.querySelector("button[data-theme-toggle]");
      expect(toggle?.textContent).toContain("Dark");
      expect(toggle?.textContent).toContain("Light");
    });

    it("hides the toggle's decorative moon/sun icons from assistive tech", () => {
      const { container } = render(<SectionNav current={null} />);
      const toggle = container.querySelector("button[data-theme-toggle]");
      const icons = toggle ? Array.from(toggle.querySelectorAll("svg")) : [];
      expect(icons.length).toBeGreaterThan(0);
      for (const icon of icons) {
        expect(icon.getAttribute("aria-hidden")).toBe("true");
      }
    });
  });

  describe("the departments bar", () => {
    it("renders exactly one link per SECTIONS entry", () => {
      render(<SectionNav current={null} />);
      const nav = screen.getByRole("navigation", { name: "Sections" });
      expect(within(nav).getAllByRole("link")).toHaveLength(SECTIONS.length);
    });

    it("gives every cell the dept class -- the current cell is styled by CSS via .dept[aria-current], not by a special class or inline style", () => {
      render(<SectionNav current="design" />);
      const currentCell = screen.getByRole("link", { name: "Design News" });
      expect(currentCell.className).toContain("dept");
      expect(currentCell.className).not.toContain("switch-current");
      expect(currentCell.getAttribute("style")).toBeNull();
      expect(screen.getByRole("link", { name: "AI News" }).className).toContain("dept");
    });

    it("labels every department cell from the SECTION_LABEL map, in SECTIONS order", () => {
      render(<SectionNav current={null} />);
      const nav = screen.getByRole("navigation", { name: "Sections" });
      const links = within(nav).getAllByRole("link");
      SECTIONS.forEach((section, i) => {
        expect(links[i]?.textContent).toBe(SECTION_LABEL[section]);
      });
    });

    it("every SECTIONS entry has a SECTION_LABEL entry, and today's labels read the full 'AI News', 'Design News' and 'Cloud News' literally (owner, 2026-08-27: the words are the affordance) -- so a new section cannot ship unlabelled, and a wrong value in the map cannot pass by matching itself", () => {
      for (const section of SECTIONS) {
        expect(SECTION_LABEL[section]).toBeTruthy();
      }

      render(<SectionNav current={null} />);
      const nav = screen.getByRole("navigation", { name: "Sections" });
      const texts = within(nav).getAllByRole("link").map((link) => link.textContent);
      expect(texts).toEqual(["AI News", "Design News", "Cloud News"]);
    });

    it("renders every section link with the right href", () => {
      render(<SectionNav current={null} />);
      expect(screen.getByRole("link", { name: "AI News" }).getAttribute("href")).toBe("/");
      expect(screen.getByRole("link", { name: "Design News" }).getAttribute("href")).toBe(
        "/design",
      );
      expect(screen.getByRole("link", { name: "Cloud News" }).getAttribute("href")).toBe("/cloud");
    });

    it("carries NO data-field anywhere -- the per-section colour worlds are retired, and a stray data-field would resurrect dead CSS hooks", () => {
      const { container } = render(<SectionNav current="ai" />);
      expect(container.querySelector("[data-field]")).toBeNull();
    });

    it("shows no story counts in the cells -- the labels are the whole cell", () => {
      render(<SectionNav current="ai" />);
      const nav = screen.getByRole("navigation", { name: "Sections" });
      for (const link of within(nav).getAllByRole("link")) {
        expect(link.textContent).not.toMatch(/\d/);
      }
    });

    it("marks the AI cell current via aria-current when current is 'ai'", () => {
      render(<SectionNav current="ai" />);
      expect(screen.getByRole("link", { name: "AI News" }).getAttribute("aria-current")).toBe(
        "page",
      );
    });

    it("does not mark the Design cell current when current is 'ai'", () => {
      render(<SectionNav current="ai" />);
      expect(
        screen.getByRole("link", { name: "Design News" }).getAttribute("aria-current"),
      ).toBeNull();
    });

    it("marks the Design cell current via aria-current when current is 'design'", () => {
      render(<SectionNav current="design" />);
      expect(screen.getByRole("link", { name: "Design News" }).getAttribute("aria-current")).toBe(
        "page",
      );
    });

    it("does not mark the AI cell current when current is 'design'", () => {
      render(<SectionNav current="design" />);
      expect(
        screen.getByRole("link", { name: "AI News" }).getAttribute("aria-current"),
      ).toBeNull();
    });

    it("marks no cell current when current is null", () => {
      render(<SectionNav current={null} />);
      expect(
        screen.getByRole("link", { name: "AI News" }).getAttribute("aria-current"),
      ).toBeNull();
      expect(
        screen.getByRole("link", { name: "Design News" }).getAttribute("aria-current"),
      ).toBeNull();
    });

    it("marks the Cloud cell current via aria-current when current is 'cloud', and leaves AI/Design uncurrent", () => {
      render(<SectionNav current="cloud" />);
      expect(screen.getByRole("link", { name: "Cloud News" }).getAttribute("aria-current")).toBe(
        "page",
      );
      expect(
        screen.getByRole("link", { name: "AI News" }).getAttribute("aria-current"),
      ).toBeNull();
      expect(
        screen.getByRole("link", { name: "Design News" }).getAttribute("aria-current"),
      ).toBeNull();
    });
  });

  describe("carrying `?days=` across a vertical switch -- fix round 1, F9", () => {
    it("omits ?days= from both links when `days` is not given at all", () => {
      render(<SectionNav current="ai" />);
      expect(screen.getByRole("link", { name: "AI News" }).getAttribute("href")).toBe("/");
      expect(screen.getByRole("link", { name: "Design News" }).getAttribute("href")).toBe(
        "/design",
      );
    });

    it("omits ?days= from both links when `days` equals the default", () => {
      render(<SectionNav current="ai" days={DEFAULT_ARCHIVE_DAYS} />);
      expect(screen.getByRole("link", { name: "Design News" }).getAttribute("href")).toBe(
        "/design",
      );
    });

    it("carries a non-default `days` value into both links", () => {
      render(<SectionNav current="ai" days={21} />);
      expect(screen.getByRole("link", { name: "AI News" }).getAttribute("href")).toBe("/?days=21");
      expect(screen.getByRole("link", { name: "Design News" }).getAttribute("href")).toBe(
        "/design?days=21",
      );
    });
  });

  describe("what moved out of the masthead -- Modern Classic, 2026-08-27", () => {
    it("carries no /search link: the Archive entry point lives in FilterRow now, so the departments are the ONLY links here", () => {
      // The old top-right Search link is retired from SectionNav, not from the product --
      // FilterRow renders the Archive link (and its own tests pin that). This test pins the
      // other half of the move: SectionNav must not grow a second, competing search entry.
      const { container } = render(<SectionNav current="ai" />);
      expect(container.querySelector('a[href^="/search"]')).toBeNull();
      expect(screen.getAllByRole("link")).toHaveLength(SECTIONS.length);
      expect(screen.getByRole("link", { name: "AI News" }).getAttribute("aria-current")).toBe(
        "page",
      );
    });
  });
});
