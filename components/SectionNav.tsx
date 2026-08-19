import Link from "next/link";
import { DEFAULT_ARCHIVE_DAYS } from "../src/lib/feed/days.js";
import type { Section } from "../src/types/article.js";

export interface SectionNavProps {
  /** The vertical currently being viewed, or `null` when neither is current. Later pages
   *  (story, archive) render this nav with `null` -- they are not themselves either vertical. */
  current: Section | null;
  /** The home feed's current `?days=` value, carried into both links so switching verticals
   *  does not silently reset how far back the reader had loaded (fix round 1, F9). Omitted (the
   *  story and day pages, which have no archive depth of their own) or equal to
   *  `DEFAULT_ARCHIVE_DAYS` renders a bare `/` / `/design` href, unchanged from before this
   *  prop existed -- there is nothing to carry when the destination would ask for the default
   *  anyway. */
  days?: number;
}

interface NavLink {
  section: Section;
  href: string;
  label: string;
}

/** Sibling nav destinations, not a filter -- the two verticals' scores were never comparable
 *  (ranking allocates its cap per section), so there is no "all" link that would imply
 *  otherwise. */
const LINKS: NavLink[] = [
  { section: "ai", href: "/", label: "AI" },
  { section: "design", href: "/design", label: "Design" },
];

/**
 * The two vertical nav destinations, `/` and `/design`. A server component -- there is no
 * state to hold, and the page already knows which vertical is current, so this takes it as an
 * explicit prop instead of deriving it from `usePathname`, which would force a client
 * component onto something the caller already knows.
 *
 * `next/link`, so moving between the verticals is a soft navigation that fetches only the new
 * page's payload instead of reloading the document. It renders an `<a>`, so `getByRole("link")`
 * still finds these, and it needs no router mounted in a jsdom test -- verified.
 */
export function SectionNav({ current, days }: SectionNavProps) {
  const suffix = days !== undefined && days !== DEFAULT_ARCHIVE_DAYS ? `?days=${days}` : "";
  return (
    <nav aria-label="Sections" className="mb-6 flex gap-4 border-b border-neutral-200 pb-3 text-sm">
      {LINKS.map((link) => {
        const isCurrent = link.section === current;
        return (
          <Link
            key={link.section}
            href={`${link.href}${suffix}`}
            aria-current={isCurrent ? "page" : undefined}
            className={
              isCurrent
                ? "font-semibold text-neutral-900"
                : "text-neutral-500 hover:text-neutral-900"
            }
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
