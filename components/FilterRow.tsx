import Link from "next/link";
import { DEFAULT_ARCHIVE_DAYS } from "../src/lib/feed/days.js";
import { FILTERS } from "../src/lib/feed/filter.js";
import type { Section } from "../src/types/article.js";
import { SECTION_LABEL } from "./SectionNav.js";

export interface FilterRowProps {
  /** Which section's five named chips to render -- `FILTERS[section]`. */
  section: Section;
  /** "/" | "/design" | "/cloud" -- where every chip and the Others form point. A prop, not
   *  `usePathname`, for the same reason `FeedArchive.basePath` is: the page already knows its
   *  own route, and reading it via a hook would force a client boundary onto a row that has no
   *  other reason to be one. */
  basePath: string;
  /** The sanitised `f` from the URL, or `null` when no filter is applied. Compared against
   *  each chip's id case-insensitively (mirrors `resolveFilter`'s own lookup) to decide which
   *  chip, if any, is active. An `activeF` that matches no known id is a free-text filter: it
   *  gets its own extra chip (see below) rather than leaving every chip looking inactive while
   *  the list is, in fact, filtered. */
  activeF: string | null;
  /** Whether `?others=1` is on the URL -- the Others control's entire "open" state, since
   *  nothing here is a client component. `false` renders a link; `true` renders the GET form. */
  othersOpen: boolean;
  /** The page's own (already-clamped) day count, carried through exactly like `SectionNav`'s
   *  own `days` prop -- omitted from a link/hidden-input whenever it equals the default, so a
   *  filter click never adds a redundant `?days=7` to every URL in the app. */
  days?: number;
}

const CHIP_BASE = "apparatus no-underline px-2.5 py-1.5";
const CHIP_INACTIVE = `${CHIP_BASE} border border-current/35 opacity-70 hover:opacity-100`;
/** `filter-active-chip` (branch review I5): `currentColor` inside an active chip is
 *  `var(--field)`, so the global `:focus-visible` ring (`2px solid currentColor`) draws field
 *  on field -- 1.00:1 on all three worlds, invisible. This class's own `:focus-visible` rule
 *  (globals.css) overrides just the outline colour to `var(--color-paper)` so the ring reads
 *  against the field ground instead. Scoped to this class alone, not a bare selector on every
 *  inverted control in the app -- `SectionNav`'s identical, pre-existing defect on the switch's
 *  current cell is out of scope for this round. */
const ACTIVE_CHIP_CLASS = `${CHIP_BASE} filter-active-chip`;
const ACTIVE_STYLE = { background: "var(--color-paper)", color: "var(--field)" } as const;

/** Builds `basePath?k=v&...`, dropping any entry whose value is `undefined` -- the one place
 *  every chip/link/hidden-input's query string is assembled, so "preserve days" and "preserve
 *  f" are each written once instead of three times (one per call site). `URLSearchParams`
 *  handles encoding; nothing here needs to reason about it. */
function buildHref(basePath: string, params: Record<string, string | undefined>): string {
  const qs = new URLSearchParams();
  for (const key of Object.keys(params)) {
    const value = params[key];
    if (value !== undefined) qs.set(key, value);
  }
  const query = qs.toString();
  return query.length > 0 ? `${basePath}?${query}` : basePath;
}

/**
 * The quick-filter row, spec 6.3: under the section switch, one apparatus label ("Inside
 * AI"/"Inside Design"/"Inside Cloud"), the section's five named chips, then Others.
 *
 * Chip grammar reuses the switch's own selection language exactly: the active chip inverts via
 * the identical inline style `SectionNav` uses for its current cell (paper background, field
 * text -- both re-derive from whichever `--field`/`--on-field` this row happens to be nested
 * inside, via the ambient `[data-field]` on `<main>`). Every inactive chip stays an outlined,
 * `opacity-70` pill -- the contrast floor's own minimum, not merely a stylistic choice.
 *
 * A free-text `activeF` (an `f` matching none of this section's five ids -- a hand-typed Others
 * submission, or a stale/foreign link) still renders as an active-styled chip, ahead of Others,
 * so the filtered state is visible and clearable even though no named chip lit up for it.
 *
 * Others is a link when closed (`?others=1`, carrying `days` and the current `f` forward so
 * opening the form does not silently drop whatever is already filtering the list) and a plain
 * GET form -- `action={basePath}`, no JS -- when open. Two server renders, honest URLs.
 */
export function FilterRow({ section, basePath, activeF, othersOpen, days }: FilterRowProps) {
  const daysParam = days !== undefined && days !== DEFAULT_ARCHIVE_DAYS ? String(days) : undefined;
  const chips = FILTERS[section];
  const activeChip =
    activeF !== null ? (chips.find((chip) => chip.id === activeF.toLowerCase()) ?? null) : null;
  const freeTextActive = activeF !== null && activeChip === null;
  const clearHref = buildHref(basePath, { days: daysParam });

  return (
    <nav
      aria-label="Quick filters"
      className="mb-8 flex flex-wrap items-center gap-2 sm:mb-11"
    >
      <span className="apparatus opacity-70">Inside {SECTION_LABEL[section]}</span>

      {chips.map((chip) =>
        activeChip?.id === chip.id ? (
          <Link
            key={chip.id}
            href={clearHref}
            className={ACTIVE_CHIP_CLASS}
            style={ACTIVE_STYLE}
            aria-current="true"
          >
            {chip.label}
          </Link>
        ) : (
          <Link
            key={chip.id}
            href={buildHref(basePath, { f: chip.id, days: daysParam })}
            className={CHIP_INACTIVE}
          >
            {chip.label}
          </Link>
        ),
      )}

      {freeTextActive ? (
        <Link href={clearHref} className={ACTIVE_CHIP_CLASS} style={ACTIVE_STYLE} aria-current="true">
          {activeF}
        </Link>
      ) : null}

      {othersOpen ? (
        <form action={basePath} method="get" className="flex items-center gap-2">
          {daysParam !== undefined ? (
            <input type="hidden" name="days" defaultValue={daysParam} />
          ) : null}
          <input
            type="text"
            name="f"
            maxLength={40}
            placeholder="filter by any word"
            aria-label="Filter by any word"
            defaultValue={freeTextActive && activeF !== null ? activeF : undefined}
            className="apparatus rounded-none border-0 border-b border-current/35 bg-transparent px-1 py-1.5 placeholder:opacity-70"
          />
          <button type="submit" className="stamp">
            Filter
          </button>
        </form>
      ) : (
        <Link
          href={buildHref(basePath, { others: "1", f: activeF ?? undefined, days: daysParam })}
          className={CHIP_INACTIVE}
          aria-expanded={othersOpen}
        >
          Others
        </Link>
      )}
    </nav>
  );
}
