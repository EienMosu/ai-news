// @vitest-environment jsdom
//
// Opt-in per file -- see the docblock in tests/feed/card.test.tsx for why: this file needs a
// DOM and explicit `afterEach(cleanup)` because `test.globals` is false project-wide.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ScoreSignals, type ScoreSignalsProps } from "../../components/ScoreSignals.js";

afterEach(cleanup);

// Every test spreads this and overrides only the prop(s) it cares about -- with six props,
// naming all of them in every call obscured which one each test was actually pinning.
const baseProps: ScoreSignalsProps = {
  category: "news",
  llmImportance: 80,
  corroborationToday: 2,
  points: 100,
  pointsImputed: false,
  recency: 0.62,
};

const renderSignals = (over: Partial<ScoreSignalsProps> = {}) =>
  render(<ScoreSignals {...baseProps} {...over} />);

describe("ScoreSignals", () => {
  describe("source weight", () => {
    it("shows the numeric weight alongside the category for a known category", () => {
      renderSignals({ category: "news" });
      expect(screen.getByTestId("source-weight").textContent).toBe("0.7 (news)");
    });

    it("shows a different weight for a different category (lab vs. news)", () => {
      renderSignals({ category: "lab" });
      expect(screen.getByTestId("source-weight").textContent).toBe("1 (lab)");
    });

    it("says the category is unknown, and prints no number, when category is null", () => {
      // Decision 5: `category === null` means unknown source weight -- say so, never fall
      // back to a number, and never print 0. The no-digit assertion is what catches a mutant
      // that falls back to `SOURCE_WEIGHTS[category ?? "community"]` (0.5) or a bare 0 instead
      // of the textual "unknown" branch -- a same-shape string check would miss both.
      renderSignals({ category: null });
      const text = screen.getByTestId("source-weight").textContent ?? "";
      expect(text).toBe("unknown source category");
      expect(/\d/.test(text)).toBe(false);
    });
  });

  describe("LLM importance", () => {
    it("shows the model's rating out of 100", () => {
      renderSignals({ llmImportance: 82 });
      expect(screen.getByTestId("llm-importance").textContent).toBe("82 / 100");
    });

    it("renders two different ratings distinctly", () => {
      // Fix round 1, finding F1: this is the direct fixed-point version of the reviewer's own
      // proof -- two articles identical in every other signal, differing only in
      // llmImportance, must never render an identical panel. computeScore scores these 255
      // points apart (722.5 vs. 467.5) on a 0-1000 scale; the panel must say so.
      const { unmount } = renderSignals({ llmImportance: 95 });
      const high = screen.getByTestId("llm-importance").textContent;
      unmount();

      renderSignals({ llmImportance: 10 });
      const low = screen.getByTestId("llm-importance").textContent;

      expect(high).not.toBe(low);
    });

    it("says not scored, and prints no number, when llmImportance is null", () => {
      renderSignals({ llmImportance: null });
      const text = screen.getByTestId("llm-importance").textContent ?? "";
      expect(text).toBe("not scored (ranking has not run for this article yet)");
      expect(/\d/.test(text)).toBe(false);
    });
  });

  describe("corroboration today", () => {
    it("shows the count with plural 'sources' for more than one", () => {
      renderSignals({ corroborationToday: 3 });
      expect(screen.getByTestId("corroboration-today").textContent).toBe("3 sources");
    });

    it("uses singular 'source' for exactly one", () => {
      renderSignals({ corroborationToday: 1 });
      expect(screen.getByTestId("corroboration-today").textContent).toBe("1 source");
    });

    it("says corroboration is not available when the value is null, rather than showing 0", () => {
      renderSignals({ corroborationToday: null });
      expect(screen.getByTestId("corroboration-today").textContent).toBe("not available");
    });
  });

  describe("engagement", () => {
    it("labels an imputed engagement value as not measured, not as a number", () => {
      // Decision 4: when pointsImputed is true the engagement input was set to a neutral 0.5
      // because the source reports no score -- it was never measured. This must not render
      // the same as a real number.
      renderSignals({ points: null, pointsImputed: true });
      const text = screen.getByTestId("engagement").textContent ?? "";
      expect(text).toContain("not measured");
      expect(/\d/.test(text)).toBe(false);
    });

    it("shows a measured engagement value as a number, distinct from the imputed rendering", () => {
      renderSignals({ points: 250, pointsImputed: false });
      expect(screen.getByTestId("engagement").textContent).toBe("250 points (measured)");
    });

    it("renders the imputed and measured cases with different text, even when points would coincide", () => {
      // The direct fixed-point version of decision 4's "write a test that fails if the two
      // render identically": same corroboration/category, only pointsImputed and points
      // differ, and the two renders must never produce equal text.
      const { unmount } = renderSignals({ points: null, pointsImputed: true });
      const imputedText = screen.getByTestId("engagement").textContent;
      unmount();

      renderSignals({ points: 0, pointsImputed: false });
      const measuredZeroText = screen.getByTestId("engagement").textContent;

      expect(imputedText).not.toBe(measuredZeroText);
    });

    it("shows unknown when points is null but pointsImputed is false", () => {
      // A defensive branch for data that should not occur by the scoring pipeline's own
      // invariant (pointsImputed = points === null), but the two fields are read from
      // independent stored attributes and shape.ts imposes no such constraint on the type.
      renderSignals({ points: null, pointsImputed: false });
      expect(screen.getByTestId("engagement").textContent).toBe("unknown");
    });
  });

  describe("recency", () => {
    it("shows the value rounded to two decimal places", () => {
      renderSignals({ recency: 0.6178 });
      expect(screen.getByTestId("recency").textContent).toContain("0.62");
    });

    it("labels the value as a live, right-now estimate, not the frozen score-time figure", () => {
      // Unlike the other four signals, recency has no "not available"/imputed state -- every
      // stored article has a firstSeenAt to fall back on. What it needs instead is honesty
      // about WHEN it was computed: unlabelled, a reader would reasonably assume this is the
      // frozen number that produced the stored score, when it is actually recomputed against
      // the moment of viewing and keeps decaying between rank runs.
      renderSignals({ recency: 0.5 });
      expect(screen.getByTestId("recency").textContent).toContain("right now");
    });
  });
});
