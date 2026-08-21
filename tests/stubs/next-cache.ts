/**
 * Pass-through stand-in for next/cache under vitest: unstable_cache needs Next's incremental
 * cache runtime, which unit tests neither have nor want. The unit suites test the raw read
 * logic; the caching CONTRACT is pinned separately by tests/design/data-cache.test.ts (source
 * scan) and verified live, where the real runtime exists.
 */
type AnyFn = (...args: never[]) => unknown;

export function unstable_cache<F extends AnyFn>(fn: F, _key?: string[], _opts?: unknown): F {
  return fn;
}
export function revalidateTag(_tag: string): void {}
export function revalidatePath(_path: string): void {}
