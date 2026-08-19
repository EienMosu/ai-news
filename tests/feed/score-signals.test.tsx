// @vitest-environment jsdom
//
// Opt-in per file -- see the docblock in tests/feed/card.test.tsx for why: this file needs a
// DOM and explicit `afterEach(cleanup)` because `test.globals` is false project-wide.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ScoreSignals } from "../../components/ScoreSignals.js";

afterEach(cleanup);

describe("ScoreSignals", () => {
  describe("source weight", () => {
    it("shows the numeric weight alongside the category for a known category", () => {
      render(
        <ScoreSignals category="news" corroborationToday={2} points={100} pointsImputed={false} />,
      );
      expect(screen.getByTestId("source-weight").textContent).toBe("0.7 (news)");
    });

    it("shows a different weight for a different category (lab vs. news)", () => {
      render(
        <ScoreSignals category="lab" corroborationToday={2} points={100} pointsImputed={false} />,
      );
      expect(screen.getByTestId("source-weight").textContent).toBe("1 (lab)");
    });

    it("says the category is unknown, and prints no number, when category is null", () => {
      // Decision 5: `category === null` means unknown source weight -- say so, never fall
      // back to a number, and never print 0. The no-digit assertion is what catches a mutant
      // that falls back to `SOURCE_WEIGHTS[category ?? "community"]` (0.5) or a bare 0 instead
      // of the textual "unknown" branch -- a same-shape string check would miss both.
      render(
        <ScoreSignals category={null} corroborationToday={2} points={100} pointsImputed={false} />,
      );
      const text = screen.getByTestId("source-weight").textContent ?? "";
      expect(text).toBe("unknown source category");
      expect(/\d/.test(text)).toBe(false);
    });
  });

  describe("corroboration today", () => {
    it("shows the count with plural 'sources' for more than one", () => {
      render(
        <ScoreSignals category="news" corroborationToday={3} points={100} pointsImputed={false} />,
      );
      expect(screen.getByTestId("corroboration-today").textContent).toBe("3 sources");
    });

    it("uses singular 'source' for exactly one", () => {
      render(
        <ScoreSignals category="news" corroborationToday={1} points={100} pointsImputed={false} />,
      );
      expect(screen.getByTestId("corroboration-today").textContent).toBe("1 source");
    });

    it("says corroboration is not available when the value is null, rather than showing 0", () => {
      render(
        <ScoreSignals category="news" corroborationToday={null} points={100} pointsImputed={false} />,
      );
      expect(screen.getByTestId("corroboration-today").textContent).toBe("not available");
    });
  });

  describe("engagement", () => {
    it("labels an imputed engagement value as not measured, not as a number", () => {
      // Decision 4: when pointsImputed is true the engagement input was set to a neutral 0.5
      // because the source reports no score -- it was never measured. This must not render
      // the same as a real number.
      render(
        <ScoreSignals category="news" corroborationToday={2} points={null} pointsImputed={true} />,
      );
      const text = screen.getByTestId("engagement").textContent ?? "";
      expect(text).toContain("not measured");
      expect(/\d/.test(text)).toBe(false);
    });

    it("shows a measured engagement value as a number, distinct from the imputed rendering", () => {
      render(
        <ScoreSignals category="news" corroborationToday={2} points={250} pointsImputed={false} />,
      );
      expect(screen.getByTestId("engagement").textContent).toBe("250 points (measured)");
    });

    it("renders the imputed and measured cases with different text, even when points would coincide", () => {
      // The direct fixed-point version of decision 4's "write a test that fails if the two
      // render identically": same corroboration/category, only pointsImputed and points
      // differ, and the two renders must never produce equal text.
      const { unmount } = render(
        <ScoreSignals category="news" corroborationToday={2} points={null} pointsImputed={true} />,
      );
      const imputedText = screen.getByTestId("engagement").textContent;
      unmount();

      render(
        <ScoreSignals category="news" corroborationToday={2} points={0} pointsImputed={false} />,
      );
      const measuredZeroText = screen.getByTestId("engagement").textContent;

      expect(imputedText).not.toBe(measuredZeroText);
    });

    it("shows unknown when points is null but pointsImputed is false", () => {
      // A defensive branch for data that should not occur by the scoring pipeline's own
      // invariant (pointsImputed = points === null), but the two fields are read from
      // independent stored attributes and shape.ts imposes no such constraint on the type.
      render(
        <ScoreSignals category="news" corroborationToday={2} points={null} pointsImputed={false} />,
      );
      expect(screen.getByTestId("engagement").textContent).toBe("unknown");
    });
  });
});
