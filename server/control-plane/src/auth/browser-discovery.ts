import type { Browser, BrowserType, LaunchOptions } from "playwright-core";

// Which browser to drive. The hosted server ships its own Chromium and names it with
// CHROMIUM_PATH (or lets Playwright find one). A local run uses the browser the person already has:
// CHROMIUM_PATH if they set it, otherwise Google Chrome, then Microsoft Edge. Nothing is ever
// downloaded.

export const LOCAL_CHANNELS = ["chrome", "msedge"] as const;

export class NoBrowserError extends Error {
  constructor() {
    super(
      "No supported browser was found. Install Google Chrome or Microsoft Edge, or set CHROMIUM_PATH to the path of a Chrome, Edge or Chromium executable."
    );
    this.name = "NoBrowserError";
  }
}

type Launch = Pick<BrowserType, "launch">["launch"];

export async function launchBrowserProcess(
  launch: Launch,
  options: Pick<LaunchOptions, "headless" | "args">,
  opts: { local: boolean; env?: NodeJS.ProcessEnv }
): Promise<Browser> {
  const env = opts.env ?? process.env;
  if (!opts.local || env.CHROMIUM_PATH) {
    // Unchanged hosted behaviour: the configured executable, or Playwright's own default.
    return launch({ ...options, executablePath: env.CHROMIUM_PATH || undefined });
  }
  for (const channel of LOCAL_CHANNELS) {
    try {
      return await launch({ ...options, channel });
    } catch {
      // not installed (or not launchable); try the next one
    }
  }
  throw new NoBrowserError();
}
