// @vitest-environment jsdom
//
// Opt-in per file -- see the docblock in tests/feed/card.test.tsx for why: this file needs a
// DOM and explicit `afterEach(cleanup)` because `test.globals` is false project-wide.
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SECTION_LABEL, SectionNav } from "../../components/SectionNav.js";
import { SECTIONS } from "../../src/types/article.js";

afterEach(cleanup);

const TAGLINE = "Each day’s news, ranked by importance, not recency.";

describe("SectionNav", () => {
  describe("the brand block", () => {
    it("renders the wordmark 'The Slow Wire'", () => {
      render(<SectionNav current={null} />);
      expect(screen.getByTestId("brand").textContent).toContain("The Slow Wire");
    });

    it("renders the tagline with the exact apparatus copy", () => {
      render(<SectionNav current={null} />);
      expect(screen.getByTestId("tagline").textContent).toBe(TAGLINE);
    });

    it("renders the masthead as the page's <h1> when asHeading is true (the default)", () => {
      render(<SectionNav current={null} />);
      const heading = screen.getByRole("heading", { level: 1 });
      expect(heading.textContent).toBe("The Slow Wire");
    });

    it("renders the masthead as a <p>, not a heading, when asHeading is false", () => {
      render(<SectionNav current={null} asHeading={false} />);
      expect(screen.queryByRole("heading")).toBeNull();
      expect(screen.getByTestId("brand").textContent).toContain("The Slow Wire");
    });

    it("hides the brand mark svg from assistive tech", () => {
      const { container } = render(<SectionNav current={null} />);
      const mark = container.querySelector("svg");
      expect(mark).not.toBeNull();
      expect(mark?.getAttribute("aria-hidden")).toBe("true");
    });
  });

  describe("the section switch", () => {
    it("renders exactly one link per SECTIONS entry", () => {
      render(<SectionNav current={null} />);
      const nav = screen.getByRole("navigation", { name: "Sections" });
      expect(within(nav).getAllByRole("link")).toHaveLength(SECTIONS.length);
    });

    it("gives the current cell the switch-current class the focus-ring override targets", () => {
    render(<SectionNav current="design" />);
    expect(screen.getByRole("link", { name: "Design" }).className).toContain("switch-current");
    expect(screen.getByRole("link", { name: "AI" }).className).not.toContain("switch-current");
  });

  it("labels every switch link from the SECTION_LABEL map, in SECTIONS order", () => {
      render(<SectionNav current={null} />);
      const nav = screen.getByRole("navigation", { name: "Sections" });
      const links = within(nav).getAllByRole("link");
      SECTIONS.forEach((section, i) => {
        expect(links[i]?.textContent).toBe(SECTION_LABEL[section]);
      });
    });

    it("every SECTIONS entry has a SECTION_LABEL entry, and today's labels read AI, Design and Cloud literally -- so a new section cannot ship unlabelled, and a wrong value in the map cannot pass by matching itself", () => {
      for (const section of SECTIONS) {
        expect(SECTION_LABEL[section]).toBeTruthy();
      }

      render(<SectionNav current={null} />);
      const nav = screen.getByRole("navigation", { name: "Sections" });
      const texts = within(nav).getAllByRole("link").map((link) => link.textContent);
      expect(texts).toEqual(["AI", "Design", "Cloud"]);
    });

    it("renders every section link with the right href", () => {
      render(<SectionNav current={null} />);
      expect(screen.getByRole("link", { name: "AI" }).getAttribute("href")).toBe("/");
      expect(screen.getByRole("link", { name: "Design" }).getAttribute("href")).toBe("/design");
      expect(screen.getByRole("link", { name: "Cloud" }).getAttribute("href")).toBe("/cloud");
    });

    it("carries data-field on each switch link matching its own section", () => {
      render(<SectionNav current="ai" />);
      expect(screen.getByRole("link", { name: "AI" }).getAttribute("data-field")).toBe("ai");
      expect(screen.getByRole("link", { name: "Design" }).getAttribute("data-field")).toBe(
        "design",
      );
      expect(screen.getByRole("link", { name: "Cloud" }).getAttribute("data-field")).toBe(
        "cloud",
      );
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
      expect(screen.getByRole("link", { name: "Design" }).getAttribute("aria-current")).toBe(
        "page",
      );
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

    it("marks the Cloud link current via aria-current when current is 'cloud', and leaves AI/Design uncurrent", () => {
      render(<SectionNav current="cloud" />);
      expect(screen.getByRole("link", { name: "Cloud" }).getAttribute("aria-current")).toBe(
        "page",
      );
      expect(screen.getByRole("link", { name: "AI" }).getAttribute("aria-current")).toBeNull();
      expect(screen.getByRole("link", { name: "Design" }).getAttribute("aria-current")).toBeNull();
    });
  });

  describe("carrying `?days=` across a vertical switch -- fix round 1, F9", () => {
    it("omits ?days= from both links when `days` is not given at all", () => {
      render(<SectionNav current="ai" />);
      expect(screen.getByRole("link", { name: "AI" }).getAttribute("href")).toBe("/");
      expect(screen.getByRole("link", { name: "Design" }).getAttribute("href")).toBe("/design");
    });

    it("omits ?days= from both links when `days` equals the default", () => {
      render(<SectionNav current="ai" days={7} />);
      expect(screen.getByRole("link", { name: "Design" }).getAttribute("href")).toBe("/design");
    });

    it("carries a non-default `days` value into both links", () => {
      render(<SectionNav current="ai" days={21} />);
      expect(screen.getByRole("link", { name: "AI" }).getAttribute("href")).toBe("/?days=21");
      expect(screen.getByRole("link", { name: "Design" }).getAttribute("href")).toBe(
        "/design?days=21",
      );
    });
  });

  describe("the Search entry point -- Task 8 fix round 1, finding 7", () => {
    it("renders a Search link alongside the section switch", () => {
      render(<SectionNav current="ai" />);
      expect(screen.getByRole("link", { name: "Search" })).toBeTruthy();
    });

    it("points a bare Search link at /search with no ?section= when current is null", () => {
      render(<SectionNav current={null} />);
      expect(screen.getByRole("link", { name: "Search" }).getAttribute("href")).toBe("/search");
    });

    it("carries ?section=ai into the Search link when current is 'ai'", () => {
      render(<SectionNav current="ai" />);
      expect(screen.getByRole("link", { name: "Search" }).getAttribute("href")).toBe(
        "/search?section=ai",
      );
    });

    it("carries ?section=design into the Search link when current is 'design'", () => {
      render(<SectionNav current="design" />);
      expect(screen.getByRole("link", { name: "Search" }).getAttribute("href")).toBe(
        "/search?section=design",
      );
    });

    it("never marks the Search link aria-current -- it is not a vertical", () => {
      render(<SectionNav current="ai" />);
      expect(screen.getByRole("link", { name: "Search" }).getAttribute("aria-current")).toBeNull();
    });

    it("adding the Search link does not disturb the name-scoped AI/Design/Cloud assertions elsewhere in this file", () => {
      // Every other test in this file finds "AI", "Design" and "Cloud" by exact accessible name
      // via getByRole("link", { name: ... }) -- a fourth link (Search, alongside the three
      // section links) cannot make those ambiguous. This test just states that invariant
      // explicitly, since the review that asked for this link verified it by inspection; this
      // is what pins it as an executable fact instead.
      render(<SectionNav current="ai" />);
      expect(screen.getAllByRole("link")).toHaveLength(4);
      expect(screen.getByRole("link", { name: "AI" }).getAttribute("aria-current")).toBe("page");
    });
  });
});
