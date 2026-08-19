import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
  // `server-only` throws unless the `react-server` export condition is active (Next.js sets
  // it for server components; Vitest does not), so anything importing src/lib/feed/read.ts
  // would fail at import time. Aliased to a no-op stub for the test run only -- the real
  // `server-only` import stays in the source file. See tests/stubs/server-only.ts.
  resolve: {
    alias: {
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
});
