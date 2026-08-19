// Stub for the `server-only` package, aliased in vitest.config.ts.
//
// `server-only`'s real `index.js` throws unless the `react-server` export condition is
// active (see its package.json `exports` map). Next.js sets that condition when building
// server components; Vitest's Node resolver does not, so importing anything that imports
// `server-only` fails at import time with "This module cannot be imported from a Client
// Component module." The fix belongs here, not in the source file: `server-only` is the
// only mechanism preventing a later refactor from pulling AWS credentials toward the
// browser bundle, so it stays in src/lib/feed/read.ts. This stub is a no-op, matching what
// `server-only`'s own `empty.js` does under the `react-server` condition it would resolve
// to in a real server-component build.
export {};
