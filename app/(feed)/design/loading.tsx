import { FeedLoading } from "../../../components/FeedLoading.js";

/**
 * The design vertical's wait.
 *
 * This file exists so the wait is vermilion rather than ink. Next resolves `loading.tsx` to the
 * nearest one above the route, so without it `/design` inherited the group's AI-coloured shell and
 * flashed the wrong world on every navigation.
 */
export default function Loading() {
  return <FeedLoading field="design" />;
}
