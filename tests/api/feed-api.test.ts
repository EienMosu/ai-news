import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/feed/read.js", () => ({
  getRecentDays: vi.fn(),
  getArticle: vi.fn(),
  getDay: vi.fn(),
}));

import { GET as feedGet } from "../../app/api/feed/route.js";
import { GET as articleGet } from "../../app/api/article/[urlHash]/route.js";
import { getArticle, getDay, getRecentDays } from "../../src/lib/feed/read.js";

const HASH = "a".repeat(64);

beforeEach(() => vi.clearAllMocks());

describe("GET /api/feed", () => {
  it("serves the section's results with the CDN cache header", async () => {
    vi.mocked(getRecentDays).mockResolvedValue({ results: [], failedDays: 0 });
    const res = await feedGet(new Request("http://x/api/feed?section=cloud&days=10"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=300");
    expect(await res.json()).toMatchObject({ section: "cloud", days: 10, failedDays: 0 });
    expect(getRecentDays).toHaveBeenCalledWith("cloud", 10);
  });

  it("defaults to ai and clamps days exactly like the web (1000 becomes 30, garbage falls back)", async () => {
    vi.mocked(getRecentDays).mockResolvedValue({ results: [], failedDays: 0 });
    await feedGet(new Request("http://x/api/feed?days=1000"));
    expect(getRecentDays).toHaveBeenLastCalledWith("ai", 30);
    await feedGet(new Request("http://x/api/feed?days=lol"));
    expect(getRecentDays).toHaveBeenLastCalledWith("ai", 5);
  });

  it("rejects an unknown section with 400 and never touches the store", async () => {
    const res = await feedGet(new Request("http://x/api/feed?section=crypto"));
    expect(res.status).toBe(400);
    expect(getRecentDays).not.toHaveBeenCalled();
  });
});

describe("GET /api/article/[urlHash]", () => {
  const params = (urlHash: string) => ({ params: Promise.resolve({ urlHash }) });

  it("rejects a malformed hash with 400 and never touches the store", async () => {
    const res = await articleGet(new Request("http://x"), params("not-a-hash"));
    expect(res.status).toBe(400);
    expect(getArticle).not.toHaveBeenCalled();
  });

  it("404s a missing article as JSON", async () => {
    vi.mocked(getArticle).mockResolvedValue(null);
    const res = await articleGet(new Request("http://x"), params(HASH));
    expect(res.status).toBe(404);
  });

  it("skips the sibling read entirely when there is no ingest day or no real cluster", async () => {
    vi.mocked(getArticle).mockResolvedValue({
      urlHash: HASH, ingestDay: null, clusterId: null,
    } as never);
    const res = await articleGet(new Request("http://x"), params(HASH));
    expect(res.status).toBe(200);
    expect(getDay).not.toHaveBeenCalled();
    expect(await res.json()).toMatchObject({ siblings: [] });
  });
});
