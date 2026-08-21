import { FeedLoading } from "../../../components/FeedLoading.js";

/**
 * The cloud vertical's wait.
 *
 * This file exists so the wait lands in pine rather than ink. Next resolves `loading.tsx` to the
 * nearest one above the route, so without it `/cloud` would inherit the group's AI-coloured shell
 * and flash the wrong world on every navigation.
 */
export default function Loading() {
  return <FeedLoading field="cloud" />;
}
