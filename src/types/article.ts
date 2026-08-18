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

export const NormalizedArticleSchema = z.object({
  urlHash: z.string().regex(/^[0-9a-f]{64}$/),
  url: z.httpUrl(),
  title: z.string().trim().min(1),
  summary: z.string(),
  imageUrl: z.httpUrl().nullable(),
  source: z.string().min(1),
  sourceName: z.string().min(1),
  category: z.enum(CATEGORIES),
  publishedAt: z.string().datetime().nullable(),
  publishedAtSource: z.enum(["feed", "fallback"]),
  points: z.number().int().nonnegative().nullable(),
});

export type NormalizedArticle = z.infer<typeof NormalizedArticleSchema>;
