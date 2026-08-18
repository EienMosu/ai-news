import { describe, expect, it, vi } from "vitest";
import { backupDay } from "../../src/lib/rank/backup.js";

const deps = (fetchImpl: typeof fetch) => ({
  fetch: fetchImpl,
  getToken: async () => "ghp_secret_value",
  repo: "EienMosu/ai-news",
});

const ok = (body: unknown, status = 200) =>
  ({ ok: status < 300, status, json: async () => body }) as Response;

describe("backupDay", () => {
  it("writes one NDJSON line per article to a dated path", async () => {
    const calls: [string, RequestInit | undefined][] = [];
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      return url.includes("?ref=") || init?.method === undefined
        ? ok({}, 404)              // no existing file
        : ok({ content: { sha: "abc" } }, 201);
    }) as unknown as typeof fetch;

    await backupDay("2026-08-18", [{ urlHash: "h1" }, { urlHash: "h2" }], deps(f));

    const put = calls.find(([, i]) => i?.method === "PUT")!;
    expect(put[0]).toContain("/contents/archive/2026-08-18.ndjson");
    const body = JSON.parse(put[1]!.body as string);
    const decoded = Buffer.from(body.content, "base64").toString("utf8");
    expect(decoded.trimEnd().split("\n")).toHaveLength(2);
    expect(JSON.parse(decoded.split("\n")[0]!)).toEqual({ urlHash: "h1" });
  });

  it("sends the token in the Authorization header and nowhere else", async () => {
    const calls: [string, RequestInit | undefined][] = [];
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      return init?.method === "PUT" ? ok({}, 201) : ok({}, 404);
    }) as unknown as typeof fetch;

    await backupDay("2026-08-18", [{ a: 1 }], deps(f));

    for (const [url, init] of calls) {
      expect(url).not.toContain("ghp_secret_value");
      expect(init?.body ?? "").not.toContain("ghp_secret_value");
      if (init?.headers) {
        expect((init.headers as Record<string, string>).Authorization).toBe("Bearer ghp_secret_value");
      }
    }
  });

  it("passes the existing file sha on update, so a re-run overwrites instead of 409ing", async () => {
    const f = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "PUT" ? ok({}, 200) : ok({ sha: "existing-sha" }, 200),
    ) as unknown as typeof fetch;

    await backupDay("2026-08-18", [{ a: 1 }], deps(f));
    const put = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls
      .find(([, i]) => i.method === "PUT")!;
    expect(JSON.parse(put[1].body as string).sha).toBe("existing-sha");
  });

  it("reports failure without throwing, so a backup problem never loses a ranked day", async () => {
    const f = vi.fn(async () => ok({ message: "Bad credentials" }, 401)) as unknown as typeof fetch;
    const result = await backupDay("2026-08-18", [{ a: 1 }], deps(f));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("401");
    expect(result.error).not.toContain("ghp_secret_value");
  });
});
