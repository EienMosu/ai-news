import Link from "next/link";
import { DEFAULT_ARCHIVE_DAYS } from "../src/lib/feed/days.js";
import type { Section } from "../src/types/article.js";

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
   * it is the heading — which also gives those routes the `<h1>` the final review found missing
   * (L11). The story page's subject is the article, so it passes `false` and keeps its own `<h1>`;
   * two `<h1>`s on one page is both wrong and ambiguous to assistive tech.
   */
  asHeading?: boolean;
}

interface NavLink {
  section: Section;
  href: string;
  label: string;
}

const MASTHEAD_CLASS =
  "font-[family-name:var(--font-display)] text-[2.5rem] font-extrabold leading-[0.92] tracking-[-0.04em] sm:text-[3rem]";

function Masthead({ asHeading }: { asHeading: boolean }) {
  return asHeading ? (
    <h1 className={MASTHEAD_CLASS}>AI&nbsp;News</h1>
  ) : (
    <p className={MASTHEAD_CLASS}>AI&nbsp;News</p>
  );
}

const LINKS: NavLink[] = [
  { section: "ai", href: "/", label: "AI" },
  { section: "design", href: "/design", label: "Design" },
];

/**
 * The masthead, and the one control that changes world.
 *
 * A server component: the page already knows which vertical is current, so deriving it from
 * `usePathname` would buy a client boundary for information already in hand.
 *
 * The two verticals are not tabs over one list — their scores were never comparable, since
 * ranking allocates its input cap per section. So the switch reads as leaving one world for
 * another: the current vertical is set solid in the field's own paper, the other sits open.
 */
export function SectionNav({ current, days, asHeading = true }: SectionNavProps) {
  const suffix = days !== undefined && days !== DEFAULT_ARCHIVE_DAYS ? `?days=${days}` : "";

  return (
    <div className="mb-8 sm:mb-11">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        {/* Deliberately not a link. A wordmark pointing at `/` would be a third control that
            silently switches vertical -- on `/design` it would carry the reader into the AI feed
            with no indication that is what it does. Switching worlds is the nav's job, visibly. */}
        <Masthead asHeading={asHeading} />

        <nav aria-label="Sections" className="flex items-stretch">
          {LINKS.map((link) => {
            const isCurrent = link.section === current;
            return (
              <Link
                key={link.section}
                href={`${link.href}${suffix}`}
                aria-current={isCurrent ? "page" : undefined}
                data-field={link.section}
                className={[
                  "apparatus border px-3 py-2 no-underline transition-colors duration-200",
                  isCurrent
                    ? "border-current"
                    : "border-current/35 opacity-75 hover:opacity-100",
                ].join(" ")}
                style={
                  isCurrent
                    ? { background: "var(--color-paper)", color: "var(--field)" }
                    : undefined
                }
              >
                {link.label}
              </Link>
            );
          })}

          {/* Not part of `LINKS` above: `NavLink.section` is typed `Section`, and search belongs
              to no vertical -- it carries the current one through as a starting scope instead. */}
          <Link
            href={`/search${current ? `?section=${current}` : ""}`}
            className="apparatus ml-3 self-center underline decoration-current/40 opacity-75 transition-opacity hover:opacity-100"
          >
            Search
          </Link>
        </nav>
      </div>
    </div>
  );
}
