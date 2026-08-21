import { z } from "zod";

export const CATEGORIES = ["news", "lab", "community", "research"] as const;
export type Category = (typeof CATEGORIES)[number];

/** Spec §5. Labs are primary sources; community is the noisiest. */
export const SOURCE_WEIGHTS: Record<Category, number> = {
  lab: 1.0,
  news: 0.7,
  research: 0.6,
  community: 0.5,
};

/**
 * The reader-facing topic vertical (AI news vs. design news), not to be confused with
 * `Category` above. The two are orthogonal: `category` is the source's TYPE — news / lab /
 * community / research — and drives `SOURCE_WEIGHTS` in the scoring formula; `section` is
 * the topic VERTICAL a reader navigates between. A design *lab* announcement and an AI *lab*
 * announcement share a category and differ only in section.
 */
export const SECTIONS = ["ai", "design", "cloud"] as const;
export type Section = (typeof SECTIONS)[number];

/**
 * The exact shape of a valid `urlHash` -- a lowercase-hex sha256 digest, 64 characters, nothing
 * else. Enforced on the write side by `NormalizedArticleSchema` below; exported here (final
 * review, N3) so the read boundary can share the identical check rather than trust one implicitly:
 * `app/(feed)/article/[urlHash]/page.tsx` rejects a shape-invalid `urlHash` before ever calling
 * `getArticle`, the same asymmetry L3 already fixed for `/day/[date]`'s date shape -- a segment
 * that cannot possibly match a stored key should not pay a `GetItem` to learn that.
 */
export const URL_HASH_SHAPE = /^[0-9a-f]{64}$/;

/** True when `hash` is a well-formed `urlHash` -- see `URL_HASH_SHAPE`'s own doc comment. */
export function isValidUrlHash(hash: string): boolean {
  return URL_HASH_SHAPE.test(hash);
}

export const NormalizedArticleSchema = z.object({
  urlHash: z.string().regex(URL_HASH_SHAPE),
  url: z.httpUrl(),
  title: z.string().trim().min(1),
  summary: z.string(),
  imageUrl: z.httpUrl().nullable(),
  source: z.string().min(1),
  sourceName: z.string().min(1),
  category: z.enum(CATEGORIES),
  section: z.enum(SECTIONS),
  publishedAt: z.iso.datetime().nullable(),
  publishedAtSource: z.enum(["feed", "fallback"]),
  points: z.number().int().nonnegative().nullable(),
});

export type NormalizedArticle = z.infer<typeof NormalizedArticleSchema>;
