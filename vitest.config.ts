import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // `include` must match `.tsx` too, not just `.ts` -- a glob of `tests/**/*.test.ts` silently
  // never collects a `.test.tsx` file. Proven: a probe file at that path containing a
  // deliberately failing assertion ran zero times under the old glob; `pnpm test` reported the
  // unchanged 33/399 green. Component tests (tests/feed/card.test.tsx) need `.tsx`.
  //
  // `environment` stays "node" globally -- most of the suite exercises the AWS SDK and should
  // never see a jsdom global. The handful of component tests that need a DOM opt in per-file
  // with a `// @vitest-environment jsdom` docblock (verified against this Vitest version's own
  // source: `detectCodeBlock` in vitest's cli-api chunk scans each test file's source for
  // `/@(?:vitest|jest)-environment\s+([\w-]+)\b/` and uses that over `project.config.environment`
  // when present), rather than a global `environment: "jsdom"` or an `environmentMatchGlobs`
  // option that no longer exists on this Vitest major.
  test: { environment: "node", include: ["tests/**/*.test.{ts,tsx}"] },
  // React 19's JSX transform needs a real plugin, not esbuild's bare default: the app's own
  // tsconfig sets `"jsx": "preserve"` (Next/webpack does the actual transform at build time),
  // so Vitest must be told how to turn JSX into `react/jsx-runtime` calls itself. Only exercised
  // by the `.tsx` test files -- everything else in the suite has no JSX to transform.
  plugins: [react()],
  // `server-only` throws unless the `react-server` export condition is active (Next.js sets
  // it for server components; Vitest does not), so anything importing src/lib/feed/read.ts
  // would fail at import time. Aliased to a no-op stub for the test run only -- the real
  // `server-only` import stays in the source file. See tests/stubs/server-only.ts.
  resolve: {
    alias: {
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
      "next/font/google": fileURLToPath(new URL("./tests/stubs/next-font-google.ts", import.meta.url)),
    },
  },
});
