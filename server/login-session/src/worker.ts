import { chromium } from "playwright";

const LMS_HOST = "lms.polite.edu.sg";
const HOME_URL = `https://${LMS_HOST}/d2l/home`;

const sessionId = requireEnv("LOGIN_SESSION_ID");
const callbackUrl = requireEnv("CALLBACK_URL");
const callbackSecret = requireEnv("CALLBACK_SECRET");

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
}

async function main() {
  const browser = await chromium.launch({ headless: false, args: ["--start-maximized"] });
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();
  await page.goto(HOME_URL, { waitUntil: "domcontentloaded" });

  const deadline = Date.now() + 6 * 60 * 1000;
  while (Date.now() < deadline) {
    const cookies = await context.cookies(`https://${LMS_HOST}`);
    if (cookies.some((c) => c.name === "d2lSessionVal")) {
      await fetch(callbackUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Callback-Secret": callbackSecret },
        body: JSON.stringify({
          sessionId,
          cookies: cookies.map((c) => ({
            name: c.name,
            value: c.value,
            domain: c.domain,
            path: c.path,
            expires: c.expires,
          })),
        }),
      });
      await browser.close();
      process.exit(0);
    }
    await page.waitForTimeout(1000);
  }

  await browser.close();
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
