import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AiLoading from "../../app/(feed)/loading.js";
import DesignLoading from "../../app/(feed)/design/loading.js";
import DayLoading from "../../app/(feed)/day/[date]/loading.js";
import SearchLoading from "../../app/(feed)/search/loading.js";
import CloudLoading from "../../app/(feed)/cloud/loading.js";

/**
 * The wait belongs to a world.
 *
 * `/design` shipped inheriting the route group's AI-coloured shell, so every navigation into the
 * design vertical flashed ink blue before the vermilion arrived. Next resolves `loading.tsx` to the
 * nearest one above the route, which makes this a routing fact no component test would catch --
 * hence one test per shell, asserting the field each actually renders.
 */
describe("the loading shell wears its own vertical", () => {
  it("waits in ink blue for the AI feed", () => {
    expect(renderToStaticMarkup(<AiLoading />)).toContain('data-field="ai"');
  });

  it("waits in vermilion for the design feed", () => {
    const markup = renderToStaticMarkup(<DesignLoading />);
    expect(markup).toContain('data-field="design"');
    expect(markup).not.toContain('data-field="ai"');
  });

  it("waits in pine for the cloud feed", () => {
    const markup = renderToStaticMarkup(<CloudLoading />);
    expect(markup).toContain('data-field="cloud"');
    expect(markup).not.toContain('data-field="ai"');
  });

  it("waits in ink for the day and search surfaces, which belong to no vertical", () => {
    for (const shell of [renderToStaticMarkup(<DayLoading />), renderToStaticMarkup(<SearchLoading />)]) {
      expect(shell).toContain('data-ground="ink"');
      expect(shell).not.toContain("data-field=");
    }
  });

  it("shows the counter and the stamp in both, not a spinner", () => {
    for (const shell of [
      renderToStaticMarkup(<AiLoading />),
      renderToStaticMarkup(<DesignLoading />),
      renderToStaticMarkup(<CloudLoading />),
    ]) {
      expect(shell).toContain("odo");
      expect(shell).toContain("Ranking");
    }
  });
});
