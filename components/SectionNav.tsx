import Link from "next/link";
import { DEFAULT_ARCHIVE_DAYS } from "../src/lib/feed/days.js";
import { SECTIONS, type Section } from "../src/types/article.js";

export interface SectionNavProps {
  /** The vertical currently being viewed, or `null` when neither is (the story page, which
   *  belongs to no vertical). */
  current: Section | null;
  /** Carried through so switching verticals does not silently reset the archive depth. */
  days?: number;
  /**
   * Whether the masthead is this page's `<h1>`.
   *
   * On the feeds, the day archive and search, the site name genuinely IS the page's subject, so
   * it is the heading; that also gives those routes the `<h1>` the final review found missing
   * (L11). The story page's subject is the article, so it passes `false` and keeps its own `<h1>`;
   * two `<h1>`s on one page is both wrong and ambiguous to assistive tech.
   */
  asHeading?: boolean;
}

/**
 * The label shown on each cell of the section switch, keyed by `Section` so a new entry in
 * `SECTIONS` (the Cloud vertical, next) fails to typecheck here until it gets a label too.
 */
export const SECTION_LABEL: Record<Section, string> = {
  ai: "AI",
  design: "Design",
};

const MASTHEAD_CLASS =
  "font-[family-name:var(--font-display)] text-[2.5rem] font-extrabold leading-[0.92] tracking-[-0.04em] sm:text-[3rem]";

function Masthead({ asHeading }: { asHeading: boolean }) {
  return asHeading ? (
    <h1 className={MASTHEAD_CLASS}>The Slow Wire</h1>
  ) : (
    <p className={MASTHEAD_CLASS}>The Slow Wire</p>
  );
}

/**
 * The masthead, and the one control that changes world.
 *
 * A server component: the page already knows which vertical is current, so deriving it from
 * `usePathname` would buy a client boundary for information already in hand.
 *
 * The verticals are not tabs over one list; their scores were never comparable, since ranking
 * allocates its input cap per section. So the switch reads as leaving one world for another: the
 * current vertical is set solid in the field's own paper, the others sit open, and hovering an
 * open cell previews the world it leads to (its own field colour, its own on-field text) purely
 * through `data-field` re-deriving `--field`/`--on-field` for that cell; no JS involved.
 */
export function SectionNav({ current, days, asHeading = true }: SectionNavProps) {
  const suffix = days !== undefined && days !== DEFAULT_ARCHIVE_DAYS ? `?days=${days}` : "";

  return (
    <div className="mb-8 sm:mb-11">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div data-testid="brand" className="flex items-start gap-2">
          {/* The mark. 26px, aria-hidden -- the wordmark beside it already names the product. */}
          <svg
            viewBox="0 0 26 26"
            aria-hidden="true"
            className="mt-1 h-[26px] w-[26px] shrink-0"
          >
            <path d="M4 3h11l7 7v13H4z" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M15 3v7h7" fill="none" stroke="currentColor" strokeWidth="2" />
          </svg>

          <div>
            {/* Deliberately not a link. A wordmark pointing at `/` would be a third control that
                silently switches vertical -- on `/design` it would carry the reader into the AI
                feed with no indication that is what it does. Switching worlds is the switch's
                job, visibly. */}
            <Masthead asHeading={asHeading} />
            <p data-testid="tagline" className="apparatus mt-1.5 max-w-[42ch] opacity-70">
              Each day&rsquo;s news, ranked by importance, not recency.
            </p>
          </div>
        </div>

        {/* Not part of the switch below: `current` is typed `Section | null`, and search belongs
            to no vertical -- it carries the current one through as a starting scope instead. */}
        <Link
          href={`/search${current ? `?section=${current}` : ""}`}
          className="apparatus self-start underline decoration-current/40 opacity-75 transition-opacity hover:opacity-100"
        >
          Search
        </Link>
      </div>

      <nav aria-label="Sections" className="mt-4 flex w-full border border-current/35">
        {SECTIONS.map((section) => {
          const isCurrent = section === current;
          return (
            <Link
              key={section}
              href={`${section === "ai" ? "/" : `/${section}`}${suffix}`}
              aria-current={isCurrent ? "page" : undefined}
              data-field={section}
              className={[
                "apparatus min-w-0 flex-1 border-current/35 px-2 py-3 text-center font-bold",
                "no-underline transition-colors duration-200 [&+a]:border-l",
                isCurrent
                  ? ""
                  : "opacity-70 hover:opacity-100 hover:bg-[var(--field)] hover:text-[var(--on-field)]",
              ].join(" ")}
              style={
                isCurrent
                  ? { background: "var(--color-paper)", color: "var(--field)" }
                  : undefined
              }
            >
              {SECTION_LABEL[section]}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
