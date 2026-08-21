import type { Section } from "../src/types/article.js";

export interface FeedLoadingProps {
  /** The vertical being opened. The wait belongs to a world, so it is painted in that world's
   *  field -- a shared shell hard-coded to one vertical flashes the wrong colour on the other. */
  field: Section;
}

/**
 * The wait, in the design's own language.
 *
 * Every route under this group is `force-dynamic` and reads DynamoDB per request, so this is a
 * real interval, not a formality — and the honest thing to show is the product's own mechanism:
 * the day being counted, then stamped. A spinner would say only that something is happening.
 *
 * It claims nothing it does not know. There is no data at this point, so the odometer cycles
 * rather than naming a total, and the stamp names the act instead of a result. The real figures
 * land with the real page.
 *
 * No client component, by constraint and to its benefit: this app ships none, so the counter is
 * a strip of digits translated under a window by `steps()` (see `.odo` in globals.css). It also
 * means this file costs nothing to hydrate.
 */
export function FeedLoading({ field }: FeedLoadingProps) {
  return (
    <main data-field={field} className="min-h-dvh bg-[var(--field)] px-5 py-10 sm:px-8 sm:py-14">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-4 sm:mb-11">
          <h1 className="font-[family-name:var(--font-display)] text-[2.5rem] font-extrabold leading-[0.92] tracking-[-0.04em] sm:text-[3rem]">
            The Slow&nbsp;Wire
          </h1>
          <p className="apparatus opacity-70">Opening the file</p>
        </div>

        <div
          data-surface="paper"
          className="px-4 pb-7 pt-5 shadow-[0_18px_40px_-24px_rgba(0,0,0,0.55)] sm:px-7 sm:pt-7"
        >
          <div className="mb-8 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-3">
            <p
              className="font-[family-name:var(--font-display)] text-[1.75rem] font-extrabold leading-none tracking-[-0.028em] sm:text-[2.25rem]"
              aria-hidden="true"
            >
              <span className="apparatus align-middle text-[0.6875rem] opacity-70">counting</span>{" "}
              <span className="odo" style={{ ["--dur" as string]: "760ms" }}>
                <i />
              </span>
              <span className="odo" style={{ ["--dur" as string]: "520ms" }}>
                <i />
              </span>
              <span className="odo" style={{ ["--dur" as string]: "340ms" }}>
                <i />
              </span>
            </p>
            <span className="stamp land" style={{ ["--delay" as string]: "260ms" }}>
              Ranking
            </span>
          </div>

          {/* Numbered rows, because the numbering IS the design: the skeleton is the file filling
              in, not a generic grey block. */}
          <ul aria-hidden="true" className="space-y-6">
            {[0, 1, 2, 3, 4].map((i) => (
              <li key={i} className="flex gap-4 sm:gap-6">
                <span data-numeric className="apparatus w-6 shrink-0 opacity-30 sm:w-8">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div className="min-w-0 flex-1 space-y-2.5">
                  <div
                    className="rule-fill h-[0.9rem]"
                    style={{ width: `${88 - i * 9}%`, animationDelay: `${i * 130}ms` }}
                  />
                  <div
                    className="rule-fill h-[0.55rem]"
                    style={{ width: `${62 - i * 6}%`, animationDelay: `${i * 130 + 90}ms` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="apparatus mt-6 opacity-70" role="status">
          Reading the day from the store
        </p>
      </div>
    </main>
  );
}
