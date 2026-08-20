import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { createHash, timingSafeEqual } from "node:crypto";

// A trigger, and nothing else -- spec §2's "Manual refresh". This route invokes
// capture-lambda only, asynchronously, and returns before capture has done any work. It must
// never reach Bedrock and must never write to DynamoDB itself: spec §2 exists because a
// refresh path that reaches ranking lets a stuck finger, or a leaked secret, spend the
// account's Bedrock credit balance. The `VercelReader` IAM user this route authenticates as
// (infra/lib/functions.ts) has neither `bedrock:InvokeModel` nor any DynamoDB write action --
// that holds structurally at the credentials layer and is not re-implemented here.
//
// Always dynamic, like every other data/side-effect-bearing route in this app (see the
// `dynamic = "force-dynamic"` comment on app/page.tsx and its siblings) -- a POST-only route
// handler is never a candidate for Next's static optimisation regardless, but this is
// explicit rather than relying on that inference, the same discipline the page routes use.
export const dynamic = "force-dynamic";

const SECRET_HEADER = "x-ingest-secret";

let cachedLambdaClient: LambdaClient | undefined;

/**
 * One client per warm invocation, not one per request -- fix round 1, F8. Mirrors
 * `src/lib/store/client.ts`'s `docClient()`: created lazily so importing this module (as a
 * test does) never constructs an SDK client or attempts credential resolution, and cached after
 * the first call so a route hit repeatedly on a warm Lambda/Vercel function reuses one
 * connection instead of paying setup cost on every request. `aws-sdk-client-mock`'s
 * `mockClient(LambdaClient)` patches the class prototype, not a specific instance, so this
 * memoization needs no test seam the way `docClient` needs `__setDocClient` -- the mock
 * intercepts `.send` on whichever instance ends up cached.
 */
function lambdaClient(): LambdaClient {
  cachedLambdaClient ??= new LambdaClient({});
  return cachedLambdaClient;
}

/**
 * SHA-256 both sides before comparing. `crypto.timingSafeEqual` throws
 * `ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH` on two buffers of different byte length -- verified
 * directly: `timingSafeEqual(Buffer.from("a"), Buffer.from("bb"))` throws that error rather
 * than returning `false`. Comparing the raw header against the raw secret with
 * `timingSafeEqual` would therefore throw a 500 for any wrong secret of the wrong length
 * (nearly all of them), which both crashes the route and leaks the real secret's length
 * through the 500-vs-401 split -- exactly the side channel `timingSafeEqual` exists to close.
 * A SHA-256 digest is always 32 bytes regardless of input length, so hashing first makes the
 * two buffers handed to `timingSafeEqual` always equal-length: the comparison never throws,
 * and the header's length is never observable through either a thrown error or a status code.
 */
function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/**
 * The one check standing between a public endpoint and an unauthenticated capture trigger.
 * `timingSafeEqual`, never `===`: spec §9 calls this out by name, because `===` on a secret
 * compares byte-by-byte and returns as soon as it finds a mismatch, leaking approximately how
 * many leading bytes were right through response timing -- the exact side channel a shared
 * secret must not have.
 */
function secretsMatch(given: string, expected: string): boolean {
  return timingSafeEqual(digest(given), digest(expected));
}

/**
 * `POST /api/ingest`. Reads `INGEST_SECRET` and `CAPTURE_FUNCTION_NAME` at call time, never at
 * module load -- the same discipline `src/lib/feed/read.ts`'s `requireTableName` uses, for the
 * same reason: importing this module (as a test does) must never itself require the
 * environment to be configured, and a misconfiguration should be reported as a named,
 * diagnosable failure rather than the SDK's own opaque error once something actually calls out.
 *
 * `INGEST_SECRET` missing is a server misconfiguration, not "no secret required" -- it returns
 * 500 and logs that the route is unconfigured. Falling back to an open trigger when the secret
 * is merely unset would be silent and far worse than a loud 500.
 *
 * A wrong secret returns 401 and invokes nothing: the secret check runs to completion, and
 * `CAPTURE_FUNCTION_NAME` is not even read, before the Lambda client is ever constructed.
 *
 * `InvocationType: "Event"` on `InvokeCommand` -- not the deprecated `lambda:InvokeAsync` API
 * the brief mentions descriptively. That is a distinct, separate IAM action that
 * `VercelReader` is not granted (only `lambda:InvokeFunction`, scoped to the capture function's
 * ARN -- infra/lib/functions.ts); asynchronous invocation through `InvokeCommand` with
 * `InvocationType: "Event"` is what that grant actually authorises. Using the deprecated API
 * would 403 rather than trigger anything.
 *
 * Returns 202 immediately, without waiting for capture to run -- the invoke is fire-and-forget,
 * and the work has not happened by the time this responds.
 */
export async function POST(request: Request): Promise<Response> {
  const expected = process.env.INGEST_SECRET;
  if (!expected) {
    console.error("INGEST_SECRET environment variable is not set");
    return new Response(null, { status: 500 });
  }

  const given = request.headers.get(SECRET_HEADER) ?? "";
  if (!secretsMatch(given, expected)) {
    return new Response(null, { status: 401 });
  }

  const functionName = process.env.CAPTURE_FUNCTION_NAME;
  if (!functionName) throw new Error("CAPTURE_FUNCTION_NAME environment variable is not set");

  await lambdaClient().send(
    new InvokeCommand({ FunctionName: functionName, InvocationType: "Event" }),
  );

  return new Response(null, { status: 202 });
}

/**
 * Every method but POST is refused, explicitly, rather than left to Next's own default
 * method-not-allowed behaviour for an undeclared handler -- an explicit `GET` here makes the
 * 405 a fact this route's own tests assert on directly, not a framework internal nothing in
 * this file exercises.
 *
 * `Allow: POST` on the 405 -- fix round 1, F9. RFC 7231 §6.5.5 says a 405 response SHOULD
 * include it, and it costs nothing here to make the endpoint self-describing to whoever wires
 * up a caller later (Task 10).
 */
export async function GET(): Promise<Response> {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
