import Link from "next/link";
import { DEFAULT_ARCHIVE_DAYS } from "../src/lib/feed/days.js";
import { FILTERS } from "../src/lib/feed/filter.js";
import type { Section } from "../src/types/article.js";

export interface FilterRowProps {
  /** Which section's five named chips to render -- `FILTERS[section]`. */
  section: Section;
  /** "/" | "/design" | "/cloud" -- where every chip and the search form point. A prop, not
   *  `usePathname`: the page already knows its own route, and reading it via a hook would force
   *  a client boundary onto a row that has no other reason to be one. */
  basePath: string;
  /** The sanitised `f` from the URL, or `null` when no filter is applied. Compared against
   *  each chip's id case-insensitively (mirrors `resolveFilter`'s own lookup). An `activeF`
   *  matching no known id is a free-text filter (a search submission): it gets its own active
   *  chip so the filtered state is visible and clearable. */
  activeF: string | null;
  /** How many of the rendered stories each chip narrows to, keyed by chip id — the chip names
   *  its own effect before it is pressed (owner, 2026-08-27). Omitted counts render nothing. */
  chipCounts?: Record<string, number>;
  /** The page's own (already-clamped) day count -- omitted from links/inputs whenever it equals
   *  the default, so a filter click never adds a redundant `?days=7` to every URL. */
  days?: number;
}

const CHIP_BASE = "apparatus no-underline rounded-full px-3 py-1.5";
const CHIP_INACTIVE = `${CHIP_BASE} border border-[var(--hair-mid)] text-[color:var(--ink)] hover:border-[var(--hair)]`;
/** The active chip presses in: ink fill, ground text — the strongest "currently narrowing"
 *  signal the Modern Classic voice allows. `filter-active-chip` keeps its focus-ring override
 *  hook. */
const ACTIVE_CHIP_CLASS = `${CHIP_BASE} filter-active-chip border border-[var(--ink)] bg-[var(--ink)] text-[var(--ground)]`;

/** Builds `basePath?k=v&...`, dropping any entry whose value is `undefined` -- the one place
 *  every link's query string is assembled. `URLSearchParams` handles encoding. */
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
 * The live-search hand: the site's SECOND authored exception to the zero-client-JS rule
 * (the first is layout.tsx's THEME_SCRIPT), added at the owner's explicit ask (2026-08-28)
 * to match the iOS app's as-you-type search. Plain inline vanilla — still no client React.
 *
 * What it does, debounced 250ms: substring-match each entry's `data-haystack` (the exact
 * haystack `matchesFilter` uses server-side: title + summary + sourceName, lowercased),
 * flip `[hidden]` on misses, renumber the visible folios 1..k (the owner's visible-position
 * rule), rewrite each sheet's `K of N stories` count, hide sheets with no matches, and show
 * one "No matches in these days." note when nothing survives — each move mirroring
 * SectionView.swift's filtered rebuild. The lead treatment and the between-entry hairline
 * re-derive by CSS alone ([data-entry] sibling rules in globals.css).
 *
 * Enter/the keyboard's search key just dismisses the keyboard (preventDefault + blur), like
 * the app. With JS disabled the listener never attaches and the form falls back to its plain
 * GET submit — the honest `?f=` URL still works, it is just no longer the primary path.
 */
export const LIVE_SEARCH_SCRIPT = `(function () {
  var nav = document.querySelector('nav[aria-label="Quick filters"]');
  if (nav === null) return;
  var input = nav.querySelector('input[name="f"]');
  if (input === null || input.form === null) return;
  input.form.addEventListener("submit", function (event) {
    event.preventDefault();
    input.blur();
  });
  var timer;
  input.addEventListener("input", function () {
    clearTimeout(timer);
    timer = setTimeout(apply, 250);
  });
  function apply() {
    var query = input.value.trim().toLowerCase();
    var shownEverywhere = 0;
    document.querySelectorAll("[data-day-sheet]").forEach(function (sheet) {
      var shown = 0;
      sheet.querySelectorAll("[data-entry]").forEach(function (entry) {
        var hit = query === "" ||
          (entry.getAttribute("data-haystack") || "").indexOf(query) !== -1;
        entry.hidden = !hit;
        if (hit) {
          shown += 1;
          var folio = entry.querySelector(".folio");
          if (folio !== null) folio.textContent = String(shown);
        }
      });
      sheet.hidden = shown === 0;
      var count = sheet.querySelector("[data-day-count]");
      if (count !== null) {
        var total = Number(count.getAttribute("data-total"));
        count.textContent = shown === total
          ? total + (total === 1 ? " story" : " stories")
          : shown + " of " + total + " stories";
      }
      shownEverywhere += shown;
    });
    var note = document.getElementById("live-empty");
    if (shownEverywhere === 0 && query !== "") {
      if (note === null) {
        note = document.createElement("p");
        note.id = "live-empty";
        note.className = "font-[family-name:var(--font-text)] text-[1.0625rem] italic opacity-80";
        note.textContent = "No matches in these days.";
        nav.parentNode.insertBefore(note, nav.nextSibling);
      }
      note.hidden = false;
    } else if (note !== null) {
      note.hidden = true;
    }
  }
})();`;

/**
 * The quick-filter zone, Modern Classic, in the iOS app's exact grammar (owner, 2026-08-28):
 * a fixed FILTER stamp with the five named chips riding sideways past it, then the app's
 * search bar underneath — hairline box, magnifier, mono placeholder, and NO button. The
 * primary search path is `LIVE_SEARCH_SCRIPT` above: typing narrows the rendered days as on
 * iOS. The markup underneath stays the same honest GET form (`?f=`), which is also the no-JS
 * fallback. The field's placeholder says exactly what it searches: these days, not the
 * archive; the archive link sits on its own line beneath.
 */
export function FilterRow({ section, basePath, activeF, chipCounts, days }: FilterRowProps) {
  const daysParam = days !== undefined && days !== DEFAULT_ARCHIVE_DAYS ? String(days) : undefined;
  const chips = FILTERS[section];
  const activeChip =
    activeF !== null ? (chips.find((chip) => chip.id === activeF.toLowerCase()) ?? null) : null;
  const freeTextActive = activeF !== null && activeChip === null;
  const clearHref = buildHref(basePath, { days: daysParam });

  return (
    <nav aria-label="Quick filters" className="mb-8 sm:mb-11">
      {/* The stamp stays put; the chips scroll past it on one line, never a second row —
          Stamp("Filter") + horizontal ScrollView, verbatim from SectionView.swift. */}
      <div className="flex items-center gap-2.5">
        <span className="stamp shrink-0">Filter</span>
        <div className="chip-row min-w-0 flex-1 items-center">
          {chips.map((chip) => {
            const isActive = activeChip?.id === chip.id;
            const count = chipCounts?.[chip.id];
            return (
              <Link
                key={chip.id}
                href={isActive ? clearHref : buildHref(basePath, { f: chip.id, days: daysParam })}
                className={isActive ? ACTIVE_CHIP_CLASS : CHIP_INACTIVE}
                aria-current={isActive ? "true" : undefined}
              >
                {chip.label}
                {count !== undefined ? (
                  <span
                    className={isActive ? "ml-1.5 opacity-80" : "ml-1.5 text-[color:var(--muted)]"}
                    data-numeric
                  >
                    {count}
                  </span>
                ) : null}
                {isActive ? <span aria-hidden="true" className="ml-1.5">×</span> : null}
              </Link>
            );
          })}

          {freeTextActive ? (
            <Link href={clearHref} className={ACTIVE_CHIP_CLASS} aria-current="true">
              {activeF}
              <span aria-hidden="true" className="ml-1.5">×</span>
            </Link>
          ) : null}
        </div>
      </div>

      {/* The app's search bar, nothing beside it (owner, 2026-08-28). One text field means
          the browser's implicit submission fires on Enter — no submit button needed. */}
      <form action={basePath} method="get" className="mt-3">
        {daysParam !== undefined ? (
          <input type="hidden" name="days" defaultValue={daysParam} />
        ) : null}
        <div className="search-field flex items-center gap-2.5 rounded-[3px] border border-[var(--hair-mid)] px-3 py-2">
          <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="shrink-0 opacity-70"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.35-4.35" /></svg>
          <input
            type="text"
            name="f"
            maxLength={40}
            enterKeyHint="search"
            placeholder="Search these days"
            aria-label="Search these days"
            defaultValue={freeTextActive && activeF !== null ? activeF : undefined}
            className="apparatus w-full border-0 bg-transparent p-0 placeholder:opacity-60"
          />
        </div>
        {/* The only road to /search on the site, so it survives the button's removal — as a
            footnote under the field, never beside it. */}
        <p className="mt-2 text-right">
          <Link
            href={`/search${section ? `?section=${section}` : ""}`}
            className="apparatus opacity-70 underline decoration-current/40 hover:opacity-100"
          >
            Search the whole archive
          </Link>
        </p>
      </form>

      {/* Runs as soon as it is parsed: the nav above already exists, and the day sheets it
          narrows are only queried inside event handlers, by which time the page is complete. */}
      <script dangerouslySetInnerHTML={{ __html: LIVE_SEARCH_SCRIPT }} />
    </nav>
  );
}
