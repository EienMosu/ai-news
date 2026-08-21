// @vitest-environment jsdom
//
// Opt-in per file -- see the docblock in tests/feed/card.test.tsx for why: this file needs a
// DOM and explicit `afterEach(cleanup)` because `test.globals` is false project-wide.
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FilterRow } from "../../components/FilterRow.js";
import { FILTERS } from "../../src/lib/feed/filter.js";

afterEach(cleanup);

describe("FilterRow", () => {
  describe("the row's own shape", () => {
    it("renders the section's five chip names plus Others, in FILTERS order", () => {
      render(<FilterRow section="ai" basePath="/" activeF={null} othersOpen={false} />);
      const nav = screen.getByRole("navigation", { name: "Quick filters" });
      const names = within(nav).getAllByRole("link").map((link) => link.textContent);
      expect(names).toEqual([...FILTERS.ai.map((chip) => chip.label), "Others"]);
    });

    it("labels the row 'Inside AI' for the ai section", () => {
      render(<FilterRow section="ai" basePath="/" activeF={null} othersOpen={false} />);
      expect(screen.getByText("Inside AI")).toBeTruthy();
    });

    it("labels the row 'Inside Design' for the design section", () => {
      render(<FilterRow section="design" basePath="/design" activeF={null} othersOpen={false} />);
      expect(screen.getByText("Inside Design")).toBeTruthy();
    });

    it("labels the row 'Inside Cloud' for the cloud section", () => {
      render(<FilterRow section="cloud" basePath="/cloud" activeF={null} othersOpen={false} />);
      expect(screen.getByText("Inside Cloud")).toBeTruthy();
    });

    it("renders the design section's own five chips, not the ai section's", () => {
      render(<FilterRow section="design" basePath="/design" activeF={null} othersOpen={false} />);
      const nav = screen.getByRole("navigation", { name: "Quick filters" });
      const names = within(nav).getAllByRole("link").map((link) => link.textContent);
      expect(names).toEqual([...FILTERS.design.map((chip) => chip.label), "Others"]);
    });
  });

  describe("active chip grammar", () => {
    it("gives the active chip the paper background / field text inline inversion, exactly like the switch", () => {
      render(<FilterRow section="ai" basePath="/" activeF="anthropic" othersOpen={false} />);
      const link = screen.getByRole("link", { name: "Anthropic" });
      expect(link.style.background).toContain("var(--color-paper)");
      expect(link.style.color).toBe("var(--field)");
    });

    it("matches a known id case-insensitively when deciding which chip is active", () => {
      render(<FilterRow section="ai" basePath="/" activeF="ANTHROPIC" othersOpen={false} />);
      const link = screen.getByRole("link", { name: "Anthropic" });
      expect(link.style.color).toBe("var(--field)");
    });

    it("links the active chip to the bare basePath, clearing f", () => {
      render(<FilterRow section="ai" basePath="/" activeF="anthropic" othersOpen={false} />);
      expect(screen.getByRole("link", { name: "Anthropic" }).getAttribute("href")).toBe("/");
    });

    it("preserves a non-default days value on the active chip's clear link", () => {
      render(
        <FilterRow section="ai" basePath="/" activeF="anthropic" othersOpen={false} days={1} />,
      );
      expect(screen.getByRole("link", { name: "Anthropic" }).getAttribute("href")).toBe(
        "/?days=1",
      );
    });

    it("omits ?days= from the active chip's clear link when days is the default", () => {
      render(
        <FilterRow section="ai" basePath="/" activeF="anthropic" othersOpen={false} days={7} />,
      );
      expect(screen.getByRole("link", { name: "Anthropic" }).getAttribute("href")).toBe("/");
    });

    it("marks only the matching chip active, leaving the rest inactive-styled", () => {
      render(<FilterRow section="ai" basePath="/" activeF="anthropic" othersOpen={false} />);
      const openai = screen.getByRole("link", { name: "OpenAI" });
      expect(openai.style.color).not.toBe("var(--field)");
      expect(openai.className).toContain("opacity-70");
    });

    // Branch review I3: colour alone conveyed the active-filter state (WCAG 1.4.1), and the
    // active chip's accessible name was identical to its inactive form.
    it("marks the active chip with aria-current, unlike SectionNav's switch it copies the grammar from", () => {
      render(<FilterRow section="ai" basePath="/" activeF="anthropic" othersOpen={false} />);
      expect(screen.getByRole("link", { name: "Anthropic" }).getAttribute("aria-current")).toBe(
        "true",
      );
    });

    it("does not mark an inactive chip with aria-current", () => {
      render(<FilterRow section="ai" basePath="/" activeF="anthropic" othersOpen={false} />);
      expect(screen.getByRole("link", { name: "OpenAI" }).getAttribute("aria-current")).toBeNull();
    });

    it("carries no aria-current anywhere when no filter is active", () => {
      render(<FilterRow section="ai" basePath="/" activeF={null} othersOpen={false} />);
      for (const chip of FILTERS.ai) {
        expect(
          screen.getByRole("link", { name: chip.label }).getAttribute("aria-current"),
        ).toBeNull();
      }
    });

    // Branch review I5: currentColor on an active chip is var(--field), so the app-wide
    // :focus-visible ring (2px solid currentColor) draws field on field -- invisible. This
    // class carries the override rule in globals.css.
    it("gives the active chip the filter-active-chip class the focus-ring override targets", () => {
      render(<FilterRow section="ai" basePath="/" activeF="anthropic" othersOpen={false} />);
      expect(screen.getByRole("link", { name: "Anthropic" }).className).toContain(
        "filter-active-chip",
      );
    });

    it("does not give an inactive chip the filter-active-chip class", () => {
      render(<FilterRow section="ai" basePath="/" activeF="anthropic" othersOpen={false} />);
      expect(screen.getByRole("link", { name: "OpenAI" }).className).not.toContain(
        "filter-active-chip",
      );
    });
  });

  describe("inactive chip hrefs", () => {
    it("links every inactive chip to ?f=<id>", () => {
      render(<FilterRow section="ai" basePath="/" activeF={null} othersOpen={false} />);
      expect(screen.getByRole("link", { name: "OpenAI" }).getAttribute("href")).toBe("/?f=openai");
      expect(screen.getByRole("link", { name: "Google" }).getAttribute("href")).toBe("/?f=google");
    });

    it("preserves a non-default days value on inactive chip hrefs", () => {
      render(<FilterRow section="ai" basePath="/" activeF={null} othersOpen={false} days={1} />);
      const href = screen.getByRole("link", { name: "OpenAI" }).getAttribute("href") ?? "";
      const url = new URL(href, "http://example.test");
      expect(url.searchParams.get("f")).toBe("openai");
      expect(url.searchParams.get("days")).toBe("1");
    });

    it("omits days from inactive chip hrefs when days is the default", () => {
      render(<FilterRow section="ai" basePath="/" activeF={null} othersOpen={false} days={7} />);
      expect(screen.getByRole("link", { name: "OpenAI" }).getAttribute("href")).toBe("/?f=openai");
    });
  });

  describe("free-text active filter", () => {
    it("shows the free text as an extra active chip, before Others, when f matches no known id", () => {
      render(<FilterRow section="ai" basePath="/" activeF="nvidia" othersOpen={false} />);
      const nav = screen.getByRole("navigation", { name: "Quick filters" });
      const names = within(nav).getAllByRole("link").map((link) => link.textContent);
      expect(names).toEqual([...FILTERS.ai.map((chip) => chip.label), "nvidia", "Others"]);
    });

    it("gives the free-text chip the same active inversion style as a matched chip", () => {
      render(<FilterRow section="ai" basePath="/" activeF="nvidia" othersOpen={false} />);
      const link = screen.getByRole("link", { name: "nvidia" });
      expect(link.style.color).toBe("var(--field)");
    });

    it("marks the free-text chip with aria-current too, exactly like a matched active chip", () => {
      render(<FilterRow section="ai" basePath="/" activeF="nvidia" othersOpen={false} />);
      expect(screen.getByRole("link", { name: "nvidia" }).getAttribute("aria-current")).toBe(
        "true",
      );
    });

    it("links the free-text chip to the bare basePath so it clears cleanly", () => {
      render(<FilterRow section="ai" basePath="/" activeF="nvidia" othersOpen={false} />);
      expect(screen.getByRole("link", { name: "nvidia" }).getAttribute("href")).toBe("/");
    });

    it("does not render an extra free-text chip when no filter is active", () => {
      render(<FilterRow section="ai" basePath="/" activeF={null} othersOpen={false} />);
      const nav = screen.getByRole("navigation", { name: "Quick filters" });
      const names = within(nav).getAllByRole("link").map((link) => link.textContent);
      expect(names).toEqual([...FILTERS.ai.map((chip) => chip.label), "Others"]);
    });

    it("does not render an extra free-text chip when f matches a known id", () => {
      render(<FilterRow section="ai" basePath="/" activeF="anthropic" othersOpen={false} />);
      const nav = screen.getByRole("navigation", { name: "Quick filters" });
      const names = within(nav).getAllByRole("link").map((link) => link.textContent);
      expect(names).toEqual([...FILTERS.ai.map((chip) => chip.label), "Others"]);
    });

    it("renders free text inert against markup injection -- escaped in the serialized markup, never a raw tag", () => {
      const payload = "<script>alert(1)</script>";
      const { container } = render(
        <FilterRow section="ai" basePath="/" activeF={payload} othersOpen={false} />,
      );
      expect(container.innerHTML).toContain("&lt;script&gt;");
      expect(container.innerHTML).not.toContain("<script>alert(1)</script>");
    });
  });

  describe("Others -- closed state", () => {
    it("shows Others as a link, not a form, when othersOpen is false", () => {
      render(<FilterRow section="ai" basePath="/" activeF={null} othersOpen={false} />);
      expect(screen.getByRole("link", { name: "Others" })).toBeTruthy();
      expect(screen.queryByRole("textbox")).toBeNull();
    });

    it("links the closed Others chip to ?others=1, preserving days and the active f", () => {
      render(
        <FilterRow section="ai" basePath="/" activeF="anthropic" othersOpen={false} days={1} />,
      );
      const href = screen.getByRole("link", { name: "Others" }).getAttribute("href") ?? "";
      const url = new URL(href, "http://example.test");
      expect(url.searchParams.get("others")).toBe("1");
      expect(url.searchParams.get("f")).toBe("anthropic");
      expect(url.searchParams.get("days")).toBe("1");
    });

    it("omits f from the Others link when no filter is active", () => {
      render(<FilterRow section="ai" basePath="/" activeF={null} othersOpen={false} />);
      const href = screen.getByRole("link", { name: "Others" }).getAttribute("href") ?? "";
      const url = new URL(href, "http://example.test");
      expect(url.searchParams.get("others")).toBe("1");
      expect(url.searchParams.has("f")).toBe(false);
    });

    // Branch review I3: spec 6.3's aria-expanded semantics on Others were absent in any form --
    // the open/closed state was legible only from which control (link vs. form) happened to
    // exist in the DOM.
    it("marks the closed Others link aria-expanded=false", () => {
      render(<FilterRow section="ai" basePath="/" activeF={null} othersOpen={false} />);
      expect(screen.getByRole("link", { name: "Others" }).getAttribute("aria-expanded")).toBe(
        "false",
      );
    });
  });

  describe("Others -- open state (the GET form)", () => {
    it("renders a GET form targeting basePath instead of the Others link", () => {
      render(<FilterRow section="ai" basePath="/" activeF={null} othersOpen={true} />);
      expect(screen.queryByRole("link", { name: "Others" })).toBeNull();
      const form = screen.getByRole("textbox").closest("form");
      expect(form).not.toBeNull();
      expect(form?.getAttribute("action")).toBe("/");
      expect(form?.getAttribute("method")).toBe("get");
    });

    it("renders a text input named f, capped at 40 characters, with the filter-by-word placeholder", () => {
      render(<FilterRow section="ai" basePath="/" activeF={null} othersOpen={true} />);
      const input = screen.getByRole("textbox") as HTMLInputElement;
      expect(input.name).toBe("f");
      expect(input.maxLength).toBe(40);
      expect(input.placeholder).toBe("filter by any word");
    });

    // Branch review I4: the placeholder is the last-resort fallback in the accessible-name
    // computation and disappears the moment the reader types -- a real aria-label is required.
    it("gives the text input a real accessible name via aria-label, not just the placeholder", () => {
      render(<FilterRow section="ai" basePath="/" activeF={null} othersOpen={true} />);
      expect(screen.getByRole("textbox", { name: "Filter by any word" })).toBeTruthy();
    });

    // Branch review I4: `focus:outline-none` opted the input out of the app's global
    // :focus-visible contract, leaving only the text caret as a keyboard focus cue.
    it("does not opt the text input out of the global :focus-visible outline", () => {
      render(<FilterRow section="ai" basePath="/" activeF={null} othersOpen={true} />);
      expect(screen.getByRole("textbox").className).not.toContain("focus:outline-none");
    });

    it("renders a stamp-styled submit button reading Filter", () => {
      render(<FilterRow section="ai" basePath="/" activeF={null} othersOpen={true} />);
      const button = screen.getByRole("button", { name: "Filter" });
      expect(button.getAttribute("type")).toBe("submit");
      expect(button.className).toContain("stamp");
    });

    it("adds a hidden days input when days is non-default", () => {
      const { container } = render(
        <FilterRow section="ai" basePath="/" activeF={null} othersOpen={true} days={14} />,
      );
      const hidden = container.querySelector(
        'input[type="hidden"][name="days"]',
      ) as HTMLInputElement | null;
      expect(hidden).not.toBeNull();
      expect(hidden?.value).toBe("14");
    });

    it("omits the hidden days input when days is the default", () => {
      const { container } = render(
        <FilterRow section="ai" basePath="/" activeF={null} othersOpen={true} days={7} />,
      );
      expect(container.querySelector('input[type="hidden"][name="days"]')).toBeNull();
    });

    it("omits the hidden days input when days is not given at all", () => {
      const { container } = render(
        <FilterRow section="ai" basePath="/" activeF={null} othersOpen={true} />,
      );
      expect(container.querySelector('input[type="hidden"][name="days"]')).toBeNull();
    });

    it("defaults the text input to the active free text so the reader can see and edit what they typed", () => {
      render(<FilterRow section="ai" basePath="/" activeF="nvidia" othersOpen={true} />);
      const input = screen.getByRole("textbox") as HTMLInputElement;
      expect(input.value).toBe("nvidia");
    });

    it("leaves the text input blank when the active filter is a known chip, not free text", () => {
      render(<FilterRow section="ai" basePath="/" activeF="anthropic" othersOpen={true} />);
      const input = screen.getByRole("textbox") as HTMLInputElement;
      expect(input.value).toBe("");
    });

    it("leaves the text input blank when no filter is active at all", () => {
      render(<FilterRow section="ai" basePath="/" activeF={null} othersOpen={true} />);
      const input = screen.getByRole("textbox") as HTMLInputElement;
      expect(input.value).toBe("");
    });

    it("still renders the section's five named chips while the Others form is open", () => {
      render(<FilterRow section="ai" basePath="/" activeF={null} othersOpen={true} />);
      for (const chip of FILTERS.ai) {
        expect(screen.getByRole("link", { name: chip.label })).toBeTruthy();
      }
    });
  });
});
