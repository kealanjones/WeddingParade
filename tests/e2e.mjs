// End-to-end check of both submission routes and the parade, in Chromium.
//
//   node tests/e2e.mjs            # against a fake in-memory Supabase
//   node tests/e2e.mjs --live     # against the real project in site/config.js
//
// Screenshots go to tests/out/.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const out = path.join(root, "tests/out");
fs.mkdirSync(out, { recursive: true });
const live = process.argv.includes("--live");
const PORT = 8766;
const FAKE = "https://fake-project.supabase.co";

const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: path.join(root, "site"), stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });

// In-memory stand-in for Supabase REST + Storage.
const db = { rows: [], files: new Map() };
async function fakeSupabase(context) {
  await context.route(`http://127.0.0.1:${PORT}/config.js`, async (route) => {
    const res = await route.fetch();
    const body = (await res.text())
      .replace(/supabaseUrl: ".*?"/, `supabaseUrl: "${FAKE}"`)
      .replace(/supabaseAnonKey: ".*?"/, `supabaseAnonKey: "sb_publishable_test"`);
    await route.fulfill({ response: res, body });
  });
  await context.route(`${FAKE}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (url.pathname.startsWith("/storage/v1/object/public/balloons/")) {
      const f = db.files.get(decodeURIComponent(url.pathname.split("/").pop()));
      return f ? route.fulfill({ status: 200, headers: { ...cors, "content-type": "image/png" }, body: f }) : route.fulfill({ status: 404, headers: cors });
    }
    if (url.pathname.startsWith("/storage/v1/object/balloons/") && req.method() === "POST") {
      db.files.set(url.pathname.split("/").pop(), req.postDataBuffer());
      fs.writeFileSync(path.join(out, `upload-${db.files.size}.png`), req.postDataBuffer());
      return route.fulfill({ status: 200, headers: cors, json: { Key: "ok" } });
    }
    if (url.pathname === "/rest/v1/balloons" && req.method() === "POST") {
      const row = JSON.parse(req.postData());
      if (row.approved !== undefined) return route.fulfill({ status: 401, headers: cors, body: "no" });
      db.rows.push({ ...row, approved: false, created_at: new Date().toISOString() });
      return route.fulfill({ status: 201, headers: cors, body: "" });
    }
    if (url.pathname === "/rest/v1/balloons" && req.method() === "GET") {
      return route.fulfill({ status: 200, headers: cors, json: db.rows.filter((r) => r.approved) });
    }
    if (url.pathname === "/rest/v1/rpc/balloon_count") {
      return route.fulfill({ status: 200, headers: cors, json: db.rows.length });
    }
    return route.fulfill({ status: 404, headers: cors, body: "unmocked " + url.pathname });
  });
}

async function newPage(viewport, opts = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: opts.dpr || 1, hasTouch: !!opts.touch, reducedMotion: opts.reduced ? "reduce" : "no-preference" });
  if (!live) await fakeSupabase(context);
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("pageerror:", e.message));
  page.on("console", (m) => m.type() === "error" && console.log("console error:", m.text()));
  page.on("dialog", (d) => { console.log("UNEXPECTED dialog:", d.message()); d.dismiss(); });
  return page;
}

const shot = (page, name, full = true) => page.screenshot({ path: path.join(out, name), fullPage: full });
const phone = { width: 390, height: 844 };
const stamp = new Date().toISOString().slice(11, 19);
const results = [];

try {
  // ---- 1. photo route on a phone ----
  {
    const page = await newPage(phone, { touch: true });
    await page.goto(`http://127.0.0.1:${PORT}/index.html`);
    await page.waitForLoadState("networkidle");
    await shot(page, "01-home-phone.png");
    await page.setInputFiles("#photo-input", path.join(root, "tests/photos/1-round.jpg"));
    await page.waitForSelector("#step-crop:not([hidden])");
    await page.waitForTimeout(400);
    await shot(page, "02-crop-phone.png", false);
    // drag the bottom-right handle a little, as a guest would
    const h = await page.locator('.handle[data-h="se"]').boundingBox();
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(h.x + h.width / 2 + 6, h.y + h.height / 2 + 10, { steps: 4 });
    await page.mouse.up();
    await page.click("#crop-done");
    await page.waitForSelector("#step-preview:not([hidden])");
    await page.waitForTimeout(400);
    await shot(page, "03-preview-phone.png", false);
    // slider and a tap on the preview should not break anything
    await page.locator("#strength").fill("70");
    await page.waitForTimeout(800);
    await page.fill("#name", `Test Photo ${stamp}`);
    await page.fill("#note", "Congratulations Sop and Bop! Wishing you a lifetime of adventures together.");
    await page.click("#submit");
    await page.waitForSelector("#step-thanks:not([hidden])", { timeout: 30000 });
    await page.waitForTimeout(400);
    await shot(page, "04-thanks-phone.png", false);
    results.push("photo route submitted");
    await page.context().close();
  }

  // ---- 2. drawing route ----
  {
    const page = await newPage(phone, { touch: true });
    await page.goto(`http://127.0.0.1:${PORT}/index.html`);
    await page.click("#start-draw");
    await page.waitForSelector("#step-draw:not([hidden])");
    // Always measure the canvas just before using it: clicking tools can scroll.
    const canvasLoc = page.locator("#draw-canvas");
    let box;
    const measure = async () => {
      await canvasLoc.scrollIntoViewIfNeeded();
      box = await canvasLoc.boundingBox();
    };
    const P = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy];
    const stroke = async (pts) => {
      await measure();
      await page.mouse.move(...P(...pts[0]));
      await page.mouse.down();
      for (const p of pts.slice(1)) await page.mouse.move(...P(...p), { steps: 3 });
      await page.mouse.up();
    };
    const tap = (fx, fy) => canvasLoc.click({ position: { x: box.width * fx, y: box.height * fy } });
    // navy outline balloon
    await page.click('.swatch[aria-label="Navy"]');
    const ring = [];
    for (let i = 0; i <= 40; i++) {
      const t = (i / 40) * Math.PI * 2;
      ring.push([0.5 + 0.33 * Math.cos(t), 0.38 + 0.3 * Math.sin(t) * (Math.sin(t) > 0 ? 1.05 : 1)]);
    }
    await stroke(ring);
    await stroke([[0.42, 0.66], [0.45, 0.82]]);
    await stroke([[0.58, 0.66], [0.55, 0.82]]);
    await stroke([[0.42, 0.82], [0.58, 0.82], [0.57, 0.92], [0.43, 0.92], [0.42, 0.82]]);
    // stripe, then bucket-fill part of the balloon
    await page.click('.swatch[aria-label="Yellow"]');
    await stroke([[0.5, 0.08], [0.5, 0.68]]);
    await page.click('.tool[data-tool="fill"]');
    await page.click('.swatch[aria-label="Red"]');
    await tap(0.35, 0.38);
    await page.click('.swatch[aria-label="Brown"]');
    await tap(0.5, 0.87);
    await measure();
    await shot(page, "05-draw-phone.png", false);
    // undo + redo the last fill to exercise undo
    await page.click("#undo");
    await tap(0.5, 0.87);
    await page.click("#draw-done");
    await page.waitForSelector("#step-preview:not([hidden])");
    await shot(page, "06-draw-preview-phone.png", false);
    await page.fill("#name", `Test Drawn ${stamp}`);
    await page.click("#submit");
    await page.waitForSelector("#step-thanks:not([hidden])", { timeout: 30000 });
    results.push("drawing route submitted");
    await page.context().close();
  }

  // ---- 3. waiting screen ----
  {
    const page = await newPage(phone);
    await page.goto(`http://127.0.0.1:${PORT}/parade.html`);
    await page.waitForSelector("#waiting:not([hidden])", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await shot(page, "07-waiting-phone.png", false);
    results.push("waiting: " + (await page.textContent("#waiting-count")));
    await page.context().close();
  }

  if (!live) {
    // approve everything, plus the cleanup test photos as extra guests
    for (const r of db.rows) r.approved = true;
    // a crowd, to check the parade with many guests
    const imgs = [...db.files.values()];
    for (let i = 0; i < 40; i++) {
      const id = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
      db.files.set(id + ".png", imgs[i % imgs.length]);
      db.rows.push({ id, name: `Guest ${i + 1}`, note: i % 3 ? "Love you both!" : null, image_path: id + ".png", approved: true });
    }
    results.push(`fake db rows: ${db.rows.length}, files: ${db.files.size}`);
  } else {
    console.log("LIVE: approve the test rows now, then press Enter to check the parade.");
    await new Promise((r) => process.stdin.once("data", r));
  }

  // ---- 4. parade on a TV and a phone ----
  for (const [name, vp] of [["tv", { width: 1920, height: 1080 }], ["phone", phone]]) {
    const page = await newPage(vp);
    await page.goto(`http://127.0.0.1:${PORT}/parade.html`);
    await page.waitForTimeout(3500);
    await shot(page, `08-parade-${name}.png`, false);
    // tap the nearest balloon we can find
    const hit = await page.evaluate(() => {
      const c = document.getElementById("sky");
      return { w: c.clientWidth, h: c.clientHeight };
    });
    let found = false;
    for (let y = 0.15; y < 0.9 && !found; y += 0.05) {
      for (let x = 0.05; x < 0.95 && !found; x += 0.05) {
        await page.mouse.click(hit.w * x, hit.h * y);
        found = await page.isVisible("#note-card");
      }
    }
    await page.waitForTimeout(500);
    await shot(page, `09-parade-card-${name}.png`, false);
    results.push(`parade ${name}: card shown=${found}`);
    await page.context().close();
  }

  // ---- 5. reduced motion ----
  {
    const page = await newPage({ width: 1280, height: 800 }, { reduced: true });
    await page.goto(`http://127.0.0.1:${PORT}/parade.html`);
    await page.waitForTimeout(2500);
    await shot(page, "10-parade-reduced.png", false);
    await page.context().close();
  }
} finally {
  console.log(results.join("\n"));
  await browser.close();
  server.kill();
}
