// Mocks `node:crypto`'s `timingSafeEqual` (wrapped, not replaced -- the real implementation
// still runs, so every other assertion in this file exercises real comparison behaviour) so
// Step 5's mutation requirement is checkable directly: a rewrite of the route's comparison from
// `timingSafeEqual` to `===` (or to `Buffer.prototype.equals`) makes the spy never get called,
// which is a distinct, named failure from "wrong secret returns 401" -- a test that only checks
// the status code would still pass under that rewrite, since `===` on two equal-length SHA-256
// digests gives the same true/false answer `timingSafeEqual` does.
//
// `vi.hoisted` (not a plain top-level `const`) because `vi.mock` factories run before the rest
// of this module's top-level code, including any `const` declared above them -- referencing an
// un-hoisted variable from inside the factory would hit the temporal-dead-zone, not the value
// this file assigns it.
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ timingSafeEqual: vi.fn() }));

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  mocks.timingSafeEqual.mockImplementation(actual.timingSafeEqual);
  return { ...actual, timingSafeEqual: mocks.timingSafeEqual };
});

import { GET, POST } from "../../app/api/ingest/route.js";

const lambda = mockClient(LambdaClient);

// Not exported by route.ts (nothing outside the route needs it) -- kept in sync by hand with
// the literal in app/api/ingest/route.ts's `SECRET_HEADER`.
const SECRET_HEADER = "x-ingest-secret";
const SECRET = "the-real-shared-secret-value";
const FUNCTION_NAME = "ai-news-capture-fn";

function postRequest(secret?: string): Request {
  const headers = new Headers();
  if (secret !== undefined) headers.set(SECRET_HEADER, secret);
  return new Request("http://localhost/api/ingest", { method: "POST", headers });
}

beforeEach(() => {
  lambda.reset();
  mocks.timingSafeEqual.mockClear();
  process.env.INGEST_SECRET = SECRET;
  process.env.CAPTURE_FUNCTION_NAME = FUNCTION_NAME;
  lambda.on(InvokeCommand).resolves({ StatusCode: 202 });
});

afterEach(() => {
  delete process.env.INGEST_SECRET;
  delete process.env.CAPTURE_FUNCTION_NAME;
});

describe("POST /api/ingest", () => {
  it("returns 202 and invokes capture exactly once for the correct secret", async () => {
    const res = await POST(postRequest(SECRET));

    expect(res.status).toBe(202);
    expect(lambda.commandCalls(InvokeCommand)).toHaveLength(1);
  });

  it("invokes with InvocationType Event, not a synchronous call", async () => {
    await POST(postRequest(SECRET));

    const call = lambda.commandCalls(InvokeCommand)[0]!.args[0].input;
    expect(call.FunctionName).toBe(FUNCTION_NAME);
    expect(call.InvocationType).toBe("Event");
  });

  it("returns 401 and invokes nothing for a wrong secret of the SAME length as the real one", async () => {
    const wrong = "x".repeat(SECRET.length);
    const res = await POST(postRequest(wrong));

    expect(res.status).toBe(401);
    expect(lambda.commandCalls(InvokeCommand)).toHaveLength(0);
  });

  it("returns 401, not 500, for a wrong secret of a DIFFERENT length -- the crash fact #1 found", async () => {
    // The naive `timingSafeEqual(Buffer.from(given), Buffer.from(expected))` throws
    // ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH here, turning a wrong secret into a 500 and leaking
    // the real secret's length through the 500-vs-401 split. Hashing both sides first (route.ts's
    // `digest`) is what this test pins: it must stay 401, and it must not throw.
    const shortWrong = "short";
    expect(shortWrong.length).not.toBe(SECRET.length);

    const res = await POST(postRequest(shortWrong));

    expect(res.status).toBe(401);
    expect(lambda.commandCalls(InvokeCommand)).toHaveLength(0);
  });

  it("returns 401 and invokes nothing when the header is absent entirely", async () => {
    const res = await POST(postRequest(undefined));

    expect(res.status).toBe(401);
    expect(lambda.commandCalls(InvokeCommand)).toHaveLength(0);
  });

  it("compares the secret with timingSafeEqual -- mutation target for Step 5", async () => {
    await POST(postRequest(SECRET));
    await POST(postRequest("wrong"));

    expect(mocks.timingSafeEqual).toHaveBeenCalled();
  });

  it("returns 500 and invokes nothing when INGEST_SECRET is not configured", async () => {
    delete process.env.INGEST_SECRET;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(postRequest(SECRET));

    expect(res.status).toBe(500);
    expect(lambda.commandCalls(InvokeCommand)).toHaveLength(0);
    errorSpy.mockRestore();
  });

  it("throws naming CAPTURE_FUNCTION_NAME when it is missing, only after the secret already matched", async () => {
    delete process.env.CAPTURE_FUNCTION_NAME;

    await expect(POST(postRequest(SECRET))).rejects.toThrow("CAPTURE_FUNCTION_NAME");
    expect(lambda.commandCalls(InvokeCommand)).toHaveLength(0);
  });
});

describe("GET /api/ingest", () => {
  it("returns 405", async () => {
    const res = await GET();
    expect(res.status).toBe(405);
  });

  it("never touches the Lambda client", async () => {
    await GET();
    expect(lambda.commandCalls(InvokeCommand)).toHaveLength(0);
  });
});
