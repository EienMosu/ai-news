import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchArchiveDay } from "../../src/lib/search/archive.js";

// `fetch` is stubbed globally, never the real network -- `vi.stubGlobal`/`vi.unstubAllGlobals`
// swap `globalThis.fetch` for a mock and restore the original after each test, so no test in
// this file (or any other, if one runs after it) can ever reach `raw.githubusercontent.com`.
beforeEach(() => {
  process.env.BACKUP_REPO = "EienMosu/ai-news";
});

afterEach(() => {
  delete process.env.BACKUP_REPO;
  vi.unstubAllGlobals();
});

const ndjsonResponse = (lines: Record<string, unknown>[]) => ({
  status: 200,
  ok: true,
  text: async () => `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`,
});

describe("fetchArchiveDay", () => {
  it("requests the exact raw.githubusercontent.com URL for the given repo and day", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ndjsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    await fetchArchiveDay("2026-08-18");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://raw.githubusercontent.com/EienMosu/ai-news/main/archive/2026-08-18.ndjson",
    );
  });

  it("sends no Authorization header -- the repo is public and this path must never carry a credential", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ndjsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    await fetchArchiveDay("2026-08-18");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]).toHaveLength(1); // URL only, no second (headers) argument at all
  });

  it("parses each NDJSON line into a raw record", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ndjsonResponse([
      { pk: "ART#a", title: "First" },
      { pk: "ART#b", title: "Second" },
    ])));

    const items = await fetchArchiveDay("2026-08-18");

    expect(items).toEqual([
      { pk: "ART#a", title: "First" },
      { pk: "ART#b", title: "Second" },
    ]);
  });

  it("returns an empty array for a 404 -- no backup file for that day is absence, not failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 404, ok: false }));
    expect(await fetchArchiveDay("2020-01-01")).toEqual([]);
  });

  it("throws for a non-404 error status, rather than degrading to an empty array", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 500, ok: false }));
    await expect(fetchArchiveDay("2026-08-18")).rejects.toThrow(/500/);
  });

  it("throws naming the missing environment variable when BACKUP_REPO is not set", async () => {
    delete process.env.BACKUP_REPO;
    vi.stubGlobal("fetch", vi.fn());
    await expect(fetchArchiveDay("2026-08-18")).rejects.toThrow("BACKUP_REPO");
  });

  it("skips blank lines rather than trying to JSON.parse an empty string", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      status: 200, ok: true, text: async () => '{"pk":"ART#a"}\n\n',
    }));
    expect(await fetchArchiveDay("2026-08-18")).toEqual([{ pk: "ART#a" }]);
  });
});
