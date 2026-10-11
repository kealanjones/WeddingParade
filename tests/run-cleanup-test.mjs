// Usage: node tests/run-cleanup-test.mjs <out.png> [strength]
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import path from "node:path";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const server = spawn("python3", ["-m", "http.server", "8765", "--bind", "127.0.0.1"], { cwd: root, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
try {
  const page = await browser.newPage({ viewport: { width: 940, height: 900 } });
  page.on("console", (m) => console.log("console:", m.text()));
  page.on("pageerror", (e) => console.log("pageerror:", e.message));
  await page.goto(`http://127.0.0.1:8765/tests/cleanup-test.html?s=${process.argv[3] || 0.5}`);
  await page.waitForFunction("window.done === true", null, { timeout: 120000 });
  console.log(JSON.stringify(await page.evaluate("window.timings")));
  await page.screenshot({ path: process.argv[2] || "cleanup.png", fullPage: true });
} finally {
  await browser.close();
  server.kill();
}
