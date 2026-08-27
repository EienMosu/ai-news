import { FeedLoading } from "../../../../components/FeedLoading.js";

/**
 * The day surface's wait, in ink: this route spans every vertical, so its shell wears the
 * single Modern Classic ground the loaded page wears (var(--ground)). Next resolves
 * the nearest loading.tsx, so without this file the route inherited the group's AI-blue shell.
 */
export default function Loading() {
  return <FeedLoading field="ink" />;
}
