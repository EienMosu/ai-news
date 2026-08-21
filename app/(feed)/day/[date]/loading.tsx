import { FeedLoading } from "../../../../components/FeedLoading.js";

/**
 * The day surface's wait, in ink: this route spans every vertical, so its shell wears the
 * neutral ground the loaded page wears (see [data-ground="ink"] in globals.css). Next resolves
 * the nearest loading.tsx, so without this file the route inherited the group's AI-blue shell.
 */
export default function Loading() {
  return <FeedLoading field="ink" />;
}
