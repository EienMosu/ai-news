// @vitest-environment jsdom
//
// Opt-in per file -- see the docblock in tests/feed/card.test.tsx for why: this file needs a
// DOM and explicit `afterEach(cleanup)` because `test.globals` is false project-wide.
//
// Modern Classic redesign (owner, 2026-08-27): the two-step Others link/form is gone -- the
// search field is always rendered -- and the "Inside X" section label is retired. The active
// chip's inversion moved from inline styles to the ink-fill utility classes, chips may carry a
// match count, and the Archive link moved here from SectionNav. These tests encode that shipped
// contract; the mechanism underneath (plain GET links and a plain GET form, honest URLs, no JS)
// is unchanged and still what most assertions pin down.
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FilterRow, LIVE_SEARCH_SCRIPT } from "../../components/FilterRow.js";
import { FILTERS } from "../../src/lib/feed/filter.js";
import { DEFAULT_ARCHIVE_DAYS } from "../../src/lib/feed/days.js";

afterEach(cleanup);

describe("FilterRow", () => {
  describe("the row's own shape", () => {
    it("renders the section's five chip names plus the archive link, in FILTERS order", () => {
      render(<FilterRow section="ai" basePath="/" activeF={null} />);
      const nav = screen.getByRole("navigation", { name: "Quick filters" });
      // The archive link is the row's only other link now that Others is gone -- it moved here
      // from SectionNav so "leave these days entirely" sits next to "search within these days".
      const names = within(nav).getAllByRole("link").map((link) => link.textContent);
      expect(names).toEqual([...FILTERS.ai.map((chip) => chip.label), "Search the whole archive"]);
    });

    it("renders the design section's own five chips, not the ai section's", () => {
      render(<FilterRow section="design" basePath="/design" activeF={null} />);
      const nav = screen.getByRole("navigation", { name: "Quick filters" });
      const names = within(nav).getAllByRole("link").map((link) => link.textContent);
      expect(names).toEqual([...FILTERS.design.map((chip) => chip.label), "Search the whole archive"]);
    });

    // The "Inside AI"/"Inside Design"/"Inside Cloud" heading is retired outright -- the
    // department nav above the row already names the section, so the label was saying it twice.
    it("renders no 'Inside X' section label for any section", () => {
      render(<FilterRow section="ai" basePath="/" activeF={null} />);
      expect(screen.queryByText(/^Inside /)).toBeNull();
    });
  });

  describe("chip counts", () => {
    // Each chip names its own effect before it is pressed (owner, 2026-08-27): the count is how
    // many of the rendered stories the chip would narrow to.
    it("renders a chip's count from chipCounts, marked data-numeric for tabular digits", () => {
      render(
        <FilterRow section="ai" basePath="/" activeF={null} chipCounts={{ openai: 3 }} />,
      );
      const link = screen.getByRole("link", { name: /OpenAI/ });
      const count = within(link).getByText("3");
      expect(count.getAttribute("data-numeric")).not.toBeNull();
    });

    it("renders nothing for a chip whose id is missing from chipCounts", () => {
      render(
        <FilterRow section="ai" basePath="/" activeF={null} chipCounts={{ openai: 3 }} />,
      );
      // Only the label -- no count span, and certainly no dishonest "0".
      expect(screen.getByRole("link", { name: "Google" }).textContent).toBe("Google");
    });

    it("renders a chip's honest zero when chipCounts says the chip matches nothing", () => {
      render(
        <FilterRow section="ai" basePath="/" activeF={null} chipCounts={{ google: 0 }} />,
      );
      // 0 is a real count, not an omission: `count !== undefined` is the render gate, so a chip
      // that matches nothing says so instead of hiding the number.
      expect(within(screen.getByRole("link", { name: /Google/ })).getByText("0")).toBeTruthy();
    });

    it("renders no counts at all when chipCounts is not passed", () => {
      render(<FilterRow section="ai" basePath="/" activeF={null} />);
      for (const chip of FILTERS.ai) {
        expect(screen.getByRole("link", { name: chip.label }).textContent).toBe(chip.label);
      }
    });

    it("keeps a chip's count visible while that chip is active", () => {
      render(
        <FilterRow section="ai" basePath="/" activeF="anthropic" chipCounts={{ anthropic: 5 }} />,
      );
      const link = screen.getByRole("link", { name: /Anthropic/ });
      expect(within(link).getByText("5")).toBeTruthy();
    });
  });

  describe("active chip grammar", () => {
    it("presses the active chip in with the ink-fill classes, via classes rather than inline style", () => {
      render(<FilterRow section="ai" basePath="/" activeF="anthropic" />);
      const link = screen.getByRole("link", { name: "Anthropic" });
      // The old inline paper/field inversion is retired with the colour worlds; the ink-on-ground
      // fill is the strongest "currently narrowing" signal the Modern Classic voice allows, and
      // it lives entirely in utility classes so the theme can restate it.
      expect(link.className).toContain("bg-[var(--ink)]");
      expect(link.className).toContain("text-[var(--ground)]");
      expect(link.getAttribute("style")).toBeNull();
    });

    it("matches a known id case-insensitively when deciding which chip is active", () => {
      render(<FilterRow section="ai" basePath="/" activeF="ANTHROPIC" />);
      // Mirrors resolveFilter's own case-insensitive lookup: a hand-typed ?f=ANTHROPIC still
      // lights the named chip instead of spawning a free-text twin.
      expect(screen.getByRole("link", { name: "Anthropic" }).className).toContain(
        "bg-[var(--ink)]",
      );
    });

    it("links the active chip to the bare basePath, clearing f", () => {
      render(<FilterRow section="ai" basePath="/" activeF="anthropic" />);
      expect(screen.getByRole("link", { name: "Anthropic" }).getAttribute("href")).toBe("/");
    });

    it("preserves a non-default days value on the active chip's clear link", () => {
      render(
        <FilterRow section="ai" basePath="/" activeF="anthropic" days={1} />,
      );
      expect(screen.getByRole("link", { name: "Anthropic" }).getAttribute("href")).toBe(
        "/?days=1",
      );
    });

    it("omits ?days= from the active chip's clear link when days is the default", () => {
      render(
        <FilterRow section="ai" basePath="/" activeF="anthropic" days={DEFAULT_ARCHIVE_DAYS} />,
      );
      expect(screen.getByRole("link", { name: "Anthropic" }).getAttribute("href")).toBe("/");
    });

    it("marks only the matching chip active, leaving the rest inactive-styled", () => {
      render(<FilterRow section="ai" basePath="/" activeF="anthropic" />);
      const openai = screen.getByRole("link", { name: "OpenAI" });
      expect(openai.className).not.toContain("bg-[var(--ink)]");
      expect(openai.className).toContain("border-[var(--hair-mid)]");
    });

    // Branch review I3 still stands under the redesign: colour alone must not convey the
    // active-filter state (WCAG 1.4.1), so the active chip carries aria-current on top of its
    // ink fill and the visible ×.
    it("marks the active chip with aria-current", () => {
      render(<FilterRow section="ai" basePath="/" activeF="anthropic" />);
      expect(screen.getByRole("link", { name: "Anthropic" }).getAttribute("aria-current")).toBe(
        "true",
      );
    });

    it("does not mark an inactive chip with aria-current", () => {
      render(<FilterRow section="ai" basePath="/" activeF="anthropic" />);
      expect(screen.getByRole("link", { name: "OpenAI" }).getAttribute("aria-current")).toBeNull();
    });

    it("carries no aria-current anywhere when no filter is active", () => {
      render(<FilterRow section="ai" basePath="/" activeF={null} />);
      for (const chip of FILTERS.ai) {
        expect(
          screen.getByRole("link", { name: chip.label }).getAttribute("aria-current"),
        ).toBeNull();
      }
    });

    // Branch review I5's mechanism survives the redesign with the colours renamed: currentColor
    // on an active chip is var(--ground), so the app-wide :focus-visible ring (2px solid
    // currentColor, drawn outside the chip) would paint ground on ground -- invisible. This
    // class is the hook the focus-ring override rule targets.
    it("gives the active chip the filter-active-chip class the focus-ring override targets", () => {
      render(<FilterRow section="ai" basePath="/" activeF="anthropic" />);
      expect(screen.getByRole("link", { name: "Anthropic" }).className).toContain(
        "filter-active-chip",
      );
    });

    it("does not give an inactive chip the filter-active-chip class", () => {
      render(<FilterRow section="ai" basePath="/" activeF="anthropic" />);
      expect(screen.getByRole("link", { name: "OpenAI" }).className).not.toContain(
        "filter-active-chip",
      );
    });

    // The × is the redesign's visible "this clears" affordance. It is decoration on top of
    // aria-current, not information of its own, so it must stay out of the accessible name --
    // "Anthropic", not "Anthropic ×", is what a screen reader announces and what these tests
    // query by.
    it("renders an aria-hidden × on the active chip, kept out of the accessible name", () => {
      render(<FilterRow section="ai" basePath="/" activeF="anthropic" />);
      const link = screen.getByRole("link", { name: "Anthropic" });
      expect(within(link).getByText("×").getAttribute("aria-hidden")).toBe("true");
    });

    it("renders no × on an inactive chip", () => {
      render(<FilterRow section="ai" basePath="/" activeF="anthropic" />);
      expect(within(screen.getByRole("link", { name: "OpenAI" })).queryByText("×")).toBeNull();
    });
  });

  describe("inactive chip hrefs", () => {
    it("links every inactive chip to ?f=<id>", () => {
      render(<FilterRow section="ai" basePath="/" activeF={null} />);
      expect(screen.getByRole("link", { name: "OpenAI" }).getAttribute("href")).toBe("/?f=openai");
      expect(screen.getByRole("link", { name: "Google" }).getAttribute("href")).toBe("/?f=google");
    });

    it("preserves a non-default days value on inactive chip hrefs", () => {
      render(<FilterRow section="ai" basePath="/" activeF={null} days={1} />);
      const href = screen.getByRole("link", { name: "OpenAI" }).getAttribute("href") ?? "";
      const url = new URL(href, "http://example.test");
      expect(url.searchParams.get("f")).toBe("openai");
      expect(url.searchParams.get("days")).toBe("1");
    });

    it("omits days from inactive chip hrefs when days is the default", () => {
      render(<FilterRow section="ai" basePath="/" activeF={null} days={DEFAULT_ARCHIVE_DAYS} />);
      expect(screen.getByRole("link", { name: "OpenAI" }).getAttribute("href")).toBe("/?f=openai");
    });
  });

  describe("free-text active filter", () => {
    it("shows the free text as an extra active chip after the named five, when f matches no known id", () => {
      render(<FilterRow section="ai" basePath="/" activeF="nvidia" />);
      const nav = screen.getByRole("navigation", { name: "Quick filters" });
      // textContent includes the aria-hidden × glyph; the accessible name (asserted below) does
      // not. The archive link stays last -- the free-text chip belongs to the chip cluster, not
      // the form.
      const names = within(nav).getAllByRole("link").map((link) => link.textContent);
      expect(names).toEqual([...FILTERS.ai.map((chip) => chip.label), "nvidia×", "Search the whole archive"]);
    });

    it("gives the free-text chip the same ink-fill active classes as a matched chip", () => {
      render(<FilterRow section="ai" basePath="/" activeF="nvidia" />);
      const link = screen.getByRole("link", { name: "nvidia" });
      expect(link.className).toContain("filter-active-chip");
      expect(link.className).toContain("bg-[var(--ink)]");
      expect(link.className).toContain("text-[var(--ground)]");
      expect(link.getAttribute("style")).toBeNull();
    });

    it("marks the free-text chip with aria-current too, exactly like a matched active chip", () => {
      render(<FilterRow section="ai" basePath="/" activeF="nvidia" />);
      expect(screen.getByRole("link", { name: "nvidia" }).getAttribute("aria-current")).toBe(
        "true",
      );
    });

    it("gives the free-text chip an aria-hidden × as well", () => {
      render(<FilterRow section="ai" basePath="/" activeF="nvidia" />);
      const link = screen.getByRole("link", { name: "nvidia" });
      expect(within(link).getByText("×").getAttribute("aria-hidden")).toBe("true");
    });

    it("links the free-text chip to the bare basePath so it clears cleanly", () => {
      render(<FilterRow section="ai" basePath="/" activeF="nvidia" />);
      expect(screen.getByRole("link", { name: "nvidia" }).getAttribute("href")).toBe("/");
    });

    it("preserves a non-default days value on the free-text chip's clear link", () => {
      render(<FilterRow section="ai" basePath="/" activeF="nvidia" days={1} />);
      expect(screen.getByRole("link", { name: "nvidia" }).getAttribute("href")).toBe("/?days=1");
    });

    it("does not render an extra free-text chip when no filter is active", () => {
      render(<FilterRow section="ai" basePath="/" activeF={null} />);
      const nav = screen.getByRole("navigation", { name: "Quick filters" });
      const names = within(nav).getAllByRole("link").map((link) => link.textContent);
      expect(names).toEqual([...FILTERS.ai.map((chip) => chip.label), "Search the whole archive"]);
    });

    it("does not render an extra free-text chip when f matches a known id", () => {
      render(<FilterRow section="ai" basePath="/" activeF="anthropic" />);
      const nav = screen.getByRole("navigation", { name: "Quick filters" });
      const names = within(nav).getAllByRole("link").map((link) => link.textContent);
      expect(names).toEqual([...FILTERS.ai.map((chip) => chip.label), "Search the whole archive"].map((name) =>
        name === "Anthropic" ? "Anthropic×" : name,
      ));
    });

    it("renders free text inert against markup injection -- never a live tag in either sink", () => {
      const payload = "<script>alert(1)</script>";
      const { container } = render(
        <FilterRow section="ai" basePath="/" activeF={payload} />,
      );
      // The payload now reaches two sinks: the chip's text (escaped as text content -- the
      // serialized markup shows the entities) and the input's value attribute, where the HTML
      // attribute serializer legally leaves < and > unescaped because they are inert inside a
      // quoted attribute. So the honest contract is not "the raw string never appears in
      // innerHTML" but "no INJECTED script element ever materialises" -- the row's only script
      // is the authored LIVE_SEARCH_SCRIPT, verbatim -- plus the value round-trips as plain
      // data, character for character.
      expect(container.innerHTML).toContain("&lt;script&gt;");
      const scripts = container.querySelectorAll("script");
      expect(scripts.length).toBe(1);
      expect(scripts[0]?.textContent).toBe(LIVE_SEARCH_SCRIPT);
      expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe(payload);
    });
  });

  // The Others link and its open/closed state machine (and with it the aria-expanded contract)
  // are retired: there is no longer a hidden control to announce as expanded or collapsed. The
  // form below IS the replacement -- always in the DOM, one keystroke away, no ?others= round
  // trip through the URL.
  describe("the always-rendered search form", () => {
    it("renders the GET form on first paint, with no Others link anywhere", () => {
      render(<FilterRow section="ai" basePath="/" activeF={null} />);
      expect(screen.queryByRole("link", { name: "Others" })).toBeNull();
      const form = screen.getByRole("textbox").closest("form");
      expect(form).not.toBeNull();
      // A plain GET form: submitting produces the same honest ?f= URL a chip link does, with
      // zero JavaScript involved.
      expect(form?.getAttribute("action")).toBe("/");
      expect(form?.getAttribute("method")).toBe("get");
    });

    it("targets the section's own basePath, not always the home feed", () => {
      render(<FilterRow section="design" basePath="/design" activeF={null} />);
      expect(screen.getByRole("textbox").closest("form")?.getAttribute("action")).toBe("/design");
    });

    it("renders a text input named f, capped at 40 characters, with the search-these-days placeholder", () => {
      render(<FilterRow section="ai" basePath="/" activeF={null} />);
      const input = screen.getByRole("textbox") as HTMLInputElement;
      expect(input.name).toBe("f");
      // The 40 mirrors sanitizeFilterParam's MAX_FILTER_PARAM_LENGTH: the browser stops the
      // reader where the server would truncate anyway.
      expect(input.maxLength).toBe(40);
      // The placeholder says exactly what the field searches: these days, not the archive --
      // the archive link beneath it covers the rest.
      expect(input.placeholder).toBe("Search these days");
    });

    // Branch review I4: the placeholder is the last-resort fallback in the accessible-name
    // computation and disappears the moment the reader types -- a real aria-label is required.
    it("gives the text input a real accessible name via aria-label, not just the placeholder", () => {
      render(<FilterRow section="ai" basePath="/" activeF={null} />);
      expect(screen.getByRole("textbox", { name: "Search these days" })).toBeTruthy();
    });

    it("renders NO button beside the field (owner, 2026-08-28): the app's bare search bar, submitted implicitly", () => {
      render(<FilterRow section="ai" basePath="/" activeF={null} />);
      // The short-lived "Search it!" submit is gone: with a single text field the browser's
      // implicit submission fires on Enter, so the form needs no button at all -- and the
      // enterKeyHint surfaces that as the keyboard's own "search" key on phones.
      expect(screen.queryByRole("button")).toBeNull();
      const input = screen.getByRole("textbox") as HTMLInputElement;
      expect(input.getAttribute("enterkeyhint")).toBe("search");
    });

    it("stamps FILTER before the chips, fixed outside the slider (the app's Stamp + ScrollView grammar)", () => {
      render(<FilterRow section="ai" basePath="/" activeF={null} />);
      const stamp = screen.getByText("Filter");
      expect(stamp.className).toContain("stamp");
      // Fixed beside the slider, not scrolling inside it: the stamp is the chip-row's sibling.
      expect(stamp.closest(".chip-row")).toBeNull();
      expect(stamp.parentElement?.querySelector(".chip-row")).not.toBeNull();
    });

    it("adds a hidden days input when days is non-default", () => {
      const { container } = render(
        <FilterRow section="ai" basePath="/" activeF={null} days={14} />,
      );
      const hidden = container.querySelector(
        'input[type="hidden"][name="days"]',
      ) as HTMLInputElement | null;
      expect(hidden).not.toBeNull();
      expect(hidden?.value).toBe("14");
    });

    it("omits the hidden days input when days is the default", () => {
      const { container } = render(
        <FilterRow section="ai" basePath="/" activeF={null} days={DEFAULT_ARCHIVE_DAYS} />,
      );
      expect(container.querySelector('input[type="hidden"][name="days"]')).toBeNull();
    });

    it("omits the hidden days input when days is not given at all", () => {
      const { container } = render(
        <FilterRow section="ai" basePath="/" activeF={null} />,
      );
      expect(container.querySelector('input[type="hidden"][name="days"]')).toBeNull();
    });

    it("defaults the text input to the active free text so the reader can see and edit what they typed", () => {
      render(<FilterRow section="ai" basePath="/" activeF="nvidia" />);
      const input = screen.getByRole("textbox") as HTMLInputElement;
      expect(input.value).toBe("nvidia");
    });

    it("leaves the text input blank when the active filter is a known chip, not free text", () => {
      render(<FilterRow section="ai" basePath="/" activeF="anthropic" />);
      const input = screen.getByRole("textbox") as HTMLInputElement;
      expect(input.value).toBe("");
    });

    it("leaves the text input blank when no filter is active at all", () => {
      render(<FilterRow section="ai" basePath="/" activeF={null} />);
      const input = screen.getByRole("textbox") as HTMLInputElement;
      expect(input.value).toBe("");
    });

    it("still renders the section's five named chips alongside the form", () => {
      render(<FilterRow section="ai" basePath="/" activeF={null} />);
      for (const chip of FILTERS.ai) {
        expect(screen.getByRole("link", { name: chip.label })).toBeTruthy();
      }
    });
  });

  describe("the archive link", () => {
    // Moved here from SectionNav in the redesign: it sits under the field (never beside it --
    // owner, 2026-08-28) so "search these days" and "search everything" are one decision,
    // made in one place.
    it("links to /search scoped to the current section", () => {
      render(<FilterRow section="ai" basePath="/" activeF={null} />);
      expect(screen.getByRole("link", { name: "Search the whole archive" }).getAttribute("href")).toBe(
        "/search?section=ai",
      );
    });

    it("carries the section through for the non-default sections too", () => {
      render(<FilterRow section="cloud" basePath="/cloud" activeF={null} />);
      expect(screen.getByRole("link", { name: "Search the whole archive" }).getAttribute("href")).toBe(
        "/search?section=cloud",
      );
    });
  });
});
