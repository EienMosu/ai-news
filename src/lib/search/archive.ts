import "server-only";
import { unstable_cache } from "next/cache";

/**
 * The env var the Lambdas already read for the same repo (`src/lambda/rank.ts`,
 * `infra/lib/functions.ts` -- `BACKUP_REPO`, e.g. `"EienMosu/ai-news"`). Reused verbatim, not
 * renamed, so the whole project has exactly one name for "which GitHub repo holds the backup."
 *
 * Read here, at call time, never at module load: importing this module during `pnpm build` or
 * a test run must not require the variable to already exist, and a module-level read would
 * freeze `undefined` in for the life of the process the first time this module is imported
 * without it set.
 */
function requireBackupRepo(): string {
  const repo = process.env.BACKUP_REPO;
  if (!repo) throw new Error("BACKUP_REPO environment variable is not set");
  return repo;
}

/**
 * One day's raw article records, straight off the public `raw.githubusercontent.com` --
 * `https://raw.githubusercontent.com/<repo>/main/archive/<day>.ndjson`. The repo is public,
 * verified with an unauthenticated `GET /repos/EienMosu/ai-news` (HTTP 200), so this
 * deliberately carries no `Authorization` header and no token: the deep-search path must never
 * become a reason to put a credential in the web app.
 *
 * A 404 means no backup file exists for that day -- a day that never ranked, or one from before
 * backups started running -- and returns `[]`, not an error. That mirrors `getDay`'s own
 * "absence reads as absence, not failure" rule for a missing `META#DAY` record. Any other
 * non-2xx status, or a thrown network error, propagates instead of degrading to `[]`: Task 8
 * decision 2's whole point is that a search must say it could not complete rather than
 * silently return a partial archive result, and swallowing a real fetch failure into an empty
 * array would do exactly the silent-partial thing the decision forbids.
 *
 * Each line is one `JSON.stringify`d article, the same shape `queryDay` returns from the
 * `feed-by-day` GSI (`backupDay` in src/lib/rank/backup.ts writes the day's re-read, scored
 * items verbatim) -- so a parsed line can go straight through `toFeedArticle`, same as a GSI
 * item can.
 */
async function fetchArchiveDayUncached(day: string): Promise<Record<string, unknown>[]> {
  const repo = requireBackupRepo();
  const url = `https://raw.githubusercontent.com/${repo}/main/archive/${day}.ndjson`;
  const res = await fetch(url);

  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`archive fetch for ${day} failed: HTTP ${res.status}`);

  const text = await res.text();
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

/**
 * Cached for a day: the archive holds CLOSED days pushed once by the rank backup, so a month
 * of history fetched twice within 24h is the same bytes. Keyed on the day argument.
 */
export const fetchArchiveDay = unstable_cache(fetchArchiveDayUncached, ["fetchArchiveDay"], {
  revalidate: 86_400,
  tags: ["archive"],
});
