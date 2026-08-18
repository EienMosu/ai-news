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
export const SECTIONS = ["ai", "design"] as const;
export type Section = (typeof SECTIONS)[number];

export const NormalizedArticleSchema = z.object({
  urlHash: z.string().regex(/^[0-9a-f]{64}$/),
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
