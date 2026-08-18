import { captureAll } from "../src/lib/ingest/capture.js";
import { computeScore } from "../src/lib/core/score.js";
import { buildSortKey } from "../src/lib/core/sortKey.js";
import { istanbulDay } from "../src/lib/core/day.js";

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 ai-news/1.0 (personal reader)",
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

const now = new Date();
const { articles, perSourceCounts, quarantined, filtered, errors } = await captureAll({
  fetchText,
  now,
});

// No Bedrock in this plan: every article scores in degraded mode, which is
// exactly the path worth eyeballing — it is what a Bedrock outage produces.
const ranked = articles
  .map((a) => {
    const { score, scoreVersion, pointsImputed } = computeScore({
      llmImportance: null,
      category: a.category,
      corroborationToday: null,
      points: a.points,
      publishedAt: a.publishedAt,
      ingestedAt: now.toISOString(),
      now,
    });
    return { ...a, score, scoreVersion, pointsImputed, sk: buildSortKey(score, a.urlHash) };
  })
  .sort((x, y) => (x.sk < y.sk ? 1 : x.sk > y.sk ? -1 : 0));

console.log(`\ningestDay: ${istanbulDay(now)}   articles: ${ranked.length}\n`);

// perSourceCounts, quarantined and filtered answer three different questions
// about the same "0" — a dead/rate-limited feed, an item that arrived but
// failed schema validation, and an item that was valid but out of scope for
// this run (too old, or beyond the per-source cap). Printed side by side so
// none of the three is ever mistaken for another; a non-zero quarantine
// count gets a "!!" marker since a silently dropped article is otherwise
// invisible, and a source that filtered out its *entire* feed (produced=0
// but filtered>0) gets its own callout, since that's alive-but-stale, not dead.
console.log("per-source counts:  (produced / filtered / quarantined)");
for (const src of Object.keys(perSourceCounts)) {
  const n = perSourceCounts[src] ?? 0;
  const f = filtered[src] ?? 0;
  const q = quarantined[src] ?? 0;
  const deadMark = n === 0 ? "!" : " ";
  const quarantineMark = q > 0 ? "!!" : "  ";
  const allFilteredNote = n === 0 && f > 0 ? "  <-- entire feed filtered (recency/cap), not dead" : "";
  console.log(
    `  ${deadMark} ${src.padEnd(18)} produced=${String(n).padStart(4)}   filtered=${String(f).padStart(4)}   quarantined=${String(q).padStart(3)} ${quarantineMark}${allFilteredNote}`,
  );
}

if (errors.length) {
  console.log("\nerrors:");
  for (const e of errors) console.log(`  ${e.source}: ${e.message}`);
}

const totalQuarantined = Object.values(quarantined).reduce((sum, n) => sum + n, 0);
const totalFiltered = Object.values(filtered).reduce((sum, n) => sum + n, 0);
console.log(
  `\ntotal quarantined across all sources: ${totalQuarantined}${totalQuarantined > 0 ? "  <-- check these sources' fixtures/schema" : ""}`,
);
console.log(`total filtered (out-of-window or over the per-source cap): ${totalFiltered}`);

console.log("\ntop 20:");
for (const a of ranked.slice(0, 20)) {
  console.log(
    `  ${String(Math.round(a.score)).padStart(4)}  ${a.sourceName.padEnd(22)} ${a.title.slice(0, 70)}`,
  );
}
