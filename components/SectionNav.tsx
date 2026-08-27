import Link from "next/link";
import { DEFAULT_ARCHIVE_DAYS } from "../src/lib/feed/days.js";
import { SECTIONS, type Section } from "../src/types/article.js";

export interface SectionNavProps {
  /** The vertical currently being viewed, or `null` when neither is (the story page, which
   *  belongs to no vertical). */
  current: Section | null;
  /** Carried through so switching sections does not silently reset the archive depth. */
  days?: number;
  /**
   * Whether the masthead is this page's `<h1>`.
   *
   * On the feeds, the day archive and search, the site name genuinely IS the page's subject, so
   * it is the heading. The story page's subject is the article, so it passes `false` and keeps
   * its own `<h1>`; two `<h1>`s on one page is both wrong and ambiguous to assistive tech.
   */
  asHeading?: boolean;
  /** The line under the masthead: the feeds pass the day and its count ("26.08.2026 · 99
   *  stories"); pages that belong to no day fall back to the tagline. */
  subline?: string;
}

/**
 * The label shown on each cell of the departments bar, keyed by `Section` so a new entry in
 * `SECTIONS` fails to typecheck here until it gets a label too. Full "… News" names (owner,
 * 2026-08-27): the words are the affordance — they say what the destination holds.
 */
export const SECTION_LABEL: Record<Section, string> = {
  ai: "AI News",
  design: "Design News",
  cloud: "Cloud News",
};

const MASTHEAD_CLASS =
  "text-center font-[family-name:var(--font-display)] text-[2.375rem] font-bold leading-none tracking-[-0.025em] sm:text-[2.75rem]";

function Masthead({ asHeading }: { asHeading: boolean }) {
  return asHeading ? (
    <h1 className={MASTHEAD_CLASS}>The Slow Wire</h1>
  ) : (
    <p className={MASTHEAD_CLASS}>The Slow Wire</p>
  );
}

/**
 * The masthead block, Modern Classic: a quiet util row (the product's claim on the left, the
 * LABELED theme toggle on the right), the centered serif masthead, the day line, then the
 * departments bar — the one control that changes section, framed by hairlines so it reads as
 * a control zone, not a caption (owner feedback: the old bare words were invisible as nav).
 *
 * A server component. The toggle is a plain <button data-theme-toggle>: layout.tsx's inline
 * script owns the click; the two labels are CSS-picked per theme (globals.css .theme-toggle),
 * so the button is honest before any script runs.
 */
export function SectionNav({ current, days, asHeading = true, subline }: SectionNavProps) {
  const suffix = days !== undefined && days !== DEFAULT_ARCHIVE_DAYS ? `?days=${days}` : "";

  return (
    <div className="mb-7 sm:mb-9">
      <div className="flex items-center justify-between gap-4">
        <span className="apparatus opacity-70">Ranked by importance</span>
        <button
          type="button"
          data-theme-toggle
          className="theme-toggle apparatus cursor-pointer rounded-full border border-[var(--hair)] bg-transparent px-3 py-1.5 font-medium"
        >
          <span className="tt-dark items-center gap-1.5">
            <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
            Dark
          </span>
          <span className="tt-light items-center gap-1.5">
            <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
            Light
          </span>
        </button>
      </div>

      {/* Deliberately not a link. A wordmark pointing at `/` would be a second control that
          silently switches section; switching is the departments bar's job, visibly. */}
      <div className="mt-3">
        <Masthead asHeading={asHeading} />
      </div>
      <p data-testid="tagline" className="apparatus mt-2 text-center opacity-70" data-numeric>
        {subline ?? "Each day’s news, ranked by importance, not recency."}
      </p>

      <nav aria-label="Sections" className="depts -mx-3.5 mt-4 sm:mx-0">
        {SECTIONS.map((section) => {
          const isCurrent = section === current;
          return (
            <Link
              key={section}
              href={`${section === "ai" ? "/" : `/${section}`}${suffix}`}
              aria-current={isCurrent ? "page" : undefined}
              className="dept"
            >
              {SECTION_LABEL[section]}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
