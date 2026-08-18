// Every source file in this repo writes relative imports with a ".js"
// extension pointing at a sibling ".ts" file (the standard NodeNext/tsc
// convention, and what Vitest's own resolver already handles transparently).
// Plain `node --experimental-strip-types` type-strips the entry file but does
// NOT remap ".js" specifiers to ".ts" siblings, so running this script
// without help fails on the very first internal import inside capture.ts.
// This loader hook is the minimal fix: on a failed ".js" resolution, retry
// the same specifier as ".ts" before giving up. No source file is touched.
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (specifier.endsWith(".js") && err && err.code === "ERR_MODULE_NOT_FOUND") {
      return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
    }
    throw err;
  }
}
