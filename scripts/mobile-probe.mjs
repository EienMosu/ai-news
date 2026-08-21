#!/usr/bin/env node
// Mobile viewport overflow probe via CDP. Launches a fresh headless Chrome for this run only,
// applies a genuine layout-viewport override (Emulation.setDeviceMetricsOverride -- the
// --window-size flag does not set one), navigates, and measures horizontal overflow against the
// REQUESTED width rather than innerWidth. Chrome expands the layout viewport to fit overflowing
// content, so innerWidth moves with the defect it is supposed to reveal; the requested width is
// the only stable yardstick.
//
// No dependencies: Node 24 has a global WebSocket and fetch.
//
// Usage: scripts/mobile-probe.mjs <url> <width> [height]
//
// Prints one JSON line: { url, requested, innerWidth, scrollWidth, overflow, widest }
// widest lists up to 8 elements wider than the requested width (px, tag, className slice, text).
//
// Exit codes:
//   0  measurement succeeded, whether or not overflow was found (an expanded viewport with real
//      overflow is a FINDING, not a probe failure)
//   1  indeterminate: the device-metrics override never applied AND nothing measurably
//      overflowed -- the one case where the probe cannot tell you anything
//   2  infrastructure failure: Chrome never came up or never exposed a page target

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function usage() {
  console.error("Usage: scripts/mobile-probe.mjs <url> <width> [height]");
  console.error("  Measures horizontal overflow at a mobile viewport width using a headless");
  console.error("  Chrome launched fresh for this run. height defaults to 844.");
}

const [, , url, widthArg, heightArg] = process.argv;

if (!url || !widthArg) {
  usage();
  process.exit(1);
}

const width = Number(widthArg);
const height = Number(heightArg ?? 844);

if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
  usage();
  process.exit(1);
}

const CHROME_PATH =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// Random high port per run so sequential or concurrent runs never collide on a stale debugger.
const port = 9223 + Math.floor(Math.random() * 10000);
const userDataDir = mkdtempSync(join(tmpdir(), "mobile-probe-"));

let chrome;
let ws;

async function main() {
  chrome = spawn(
    CHROME_PATH,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  // Poll for the DevTools endpoint instead of a fixed sleep -- Chrome's startup time varies.
  let targets;
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      if (targets.some((t) => t.type === "page")) break;
    } catch {
      // Debugger endpoint not up yet.
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  const page = targets?.find((t) => t.type === "page");
  if (!page) {
    throw new InfraError("Chrome never exposed a page target on the debugger port.");
  }

  ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  });
  await new Promise((r) => ws.addEventListener("open", r));
  const send = (method, params = {}) =>
    new Promise((res) => {
      const n = ++id;
      pending.set(n, res);
      ws.send(JSON.stringify({ id: n, method, params }));
    });

  // Order matters: navigate first, THEN override, then let it reflow. Setting the override
  // before navigation races and silently lays out at the window size instead.
  await send("Page.enable");
  await send("Page.navigate", { url });
  await new Promise((r) => setTimeout(r, 4000));

  // Re-assert until the layout viewport actually reports the width we asked for. One shot is
  // not always enough for the override to land.
  let applied = false;
  for (let attempt = 1; attempt <= 4 && !applied; attempt++) {
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await new Promise((r) => setTimeout(r, 1200));
    const w = await send("Runtime.evaluate", {
      expression: `[innerWidth, document.readyState, location.pathname].join("|")`,
      returnByValue: true,
    });
    const seen = w.result.result.value;
    console.error(`  attempt ${attempt}: ${seen}`);
    applied = seen.startsWith(width + "|");
  }

  // Measured against the REQUESTED width (TARGET), never innerWidth: an overflowing page makes
  // Chrome grow the layout viewport, so innerWidth is the defect moving the yardstick.
  const probe = await send("Runtime.evaluate", {
    expression: `(()=>{const TARGET=${width};return JSON.stringify({
      innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      widest: [...document.querySelectorAll("*")]
        .map(el => ({ el, w: el.getBoundingClientRect().width }))
        .filter(x => x.w > TARGET + 1)
        .sort((a, b) => b.w - a.w)
        .slice(0, 8)
        .map(x => Math.round(x.w) + "px  " + x.el.tagName.toLowerCase()
             + (x.el.className ? "." + String(x.el.className).slice(0, 44) : "")
             + "  text=" + JSON.stringify((x.el.textContent || "").trim().slice(0, 40))),
    })})()`,
    returnByValue: true,
  });
  const data = JSON.parse(probe.result.result.value);

  const overflow =
    data.widest.length > 0 || data.scrollWidth > width + 1 || data.innerWidth > width + 1;

  const result = {
    url,
    requested: width,
    innerWidth: data.innerWidth,
    scrollWidth: data.scrollWidth,
    overflow,
    widest: data.widest,
  };

  console.log(JSON.stringify(result));

  // Exit 1 only when the override never applied AND nothing measurably overflowed: that is an
  // indeterminate run, not a finding. An expanded viewport with real overflow is a finding
  // (exit 0), even though the override never "held" in the innerWidth sense.
  if (!applied && !overflow) {
    console.error("mobile-probe: indeterminate -- override never applied and no overflow measured.");
    return 1;
  }
  return 0;
}

class InfraError extends Error {}

let code;
try {
  code = await main();
} catch (err) {
  console.error(`mobile-probe: ${err instanceof Error ? err.message : String(err)}`);
  code = 2;
} finally {
  try {
    ws?.close();
  } catch {
    // already closed
  }
  try {
    chrome?.kill("SIGKILL");
  } catch {
    // already dead
  }
  try {
    rmSync(userDataDir, { recursive: true, force: true });
  } catch {
    // best effort
  }
}

process.exit(code);
