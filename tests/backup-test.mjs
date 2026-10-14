// Exercises scripts/backup.mjs, decrypt-backup.mjs and restore.mjs against
// an in-memory stand-in for Supabase.   node tests/backup-test.mjs
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileP = promisify(execFile);
import assert from "node:assert/strict";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const tmp = fs.mkdtempSync(path.join(process.env.TEST_TMP || os.tmpdir(), "parade-backup-"));
const png = (n) => Buffer.from(`\x89PNG fake picture ${n}`);
const jpg = (n) => Buffer.from(`\xff\xd8 fake original photo ${n}`);
const id = (n) => `0000000${n}-0000-4000-8000-000000000000`;

function fakeSupabase() {
  const db = { rows: [], files: new Map(), originals: new Map(), noOriginals: false, requests: 0, downloads: 0 };
  const server = http.createServer(async (req, res) => {
    db.requests++;
    const url = new URL(req.url, "http://x");
    const body = await new Promise((r) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => r(Buffer.concat(c))); });
    assert.equal(req.headers.apikey, "sb_secret_test", "service key sent");
    const json = (code, v) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(v)); };
    if (url.pathname === "/rest/v1/balloons" && req.method === "GET") return json(200, db.rows);
    if (url.pathname === "/rest/v1/balloons_archive") return json(200, db.rows.map((b, i) => ({ archive_id: i + 1, action: "insert", balloon: b })));
    if (url.pathname === "/rest/v1/balloons" && req.method === "POST") {
      const row = JSON.parse(body);
      if (!db.rows.some((r) => r.id === row.id)) db.rows.push(row);
      res.writeHead(201); return res.end();
    }
    const store = (bucket) => (bucket === "originals" ? db.originals : db.files);
    const l = url.pathname.match(/^\/storage\/v1\/object\/list\/(balloons|originals)$/);
    if (l) {
      if (l[1] === "originals" && db.noOriginals) return json(400, { error: "Bucket not found" });
      return json(200, [...store(l[1]).keys()].map((name) => ({ name, id: name })));
    }
    const m = url.pathname.match(/^\/storage\/v1\/object\/(balloons|originals)\/(.+)$/);
    if (m && req.method === "GET") {
      const f = store(m[1]).get(decodeURIComponent(m[2]));
      db.downloads++;
      if (!f) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "content-type": "image/png" }); return res.end(f);
    }
    if (m && req.method === "POST") { store(m[1]).set(decodeURIComponent(m[2]), body); res.writeHead(200); return res.end("{}"); }
    res.writeHead(404); res.end("unmocked " + url.pathname);
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ db, server, url: `http://127.0.0.1:${server.address().port}` })));
}

// async, so the fake server in this process can answer while scripts run
const run = async (script, args, env) =>
  (await execFileP("node", [path.join(root, "scripts", script), ...args], {
    env: { ...process.env, SUPABASE_SERVICE_KEY: "sb_secret_test", BACKUP_PASSPHRASE: "correct horse", GITHUB_ACTIONS: "", ...env },
    encoding: "utf8",
  })).stdout.trim();

const live = await fakeSupabase();
const env = { SUPABASE_URL: live.url };
const backup = path.join(tmp, "backup");
for (const n of [1, 2]) {
  live.db.rows.push({ id: id(n), created_at: `2026-10-1${n}T10:00:00Z`, name: `Guest ${n}`, note: n === 1 ? 'Hello, "you two"' : null, image_path: `${id(n)}.png`, source: "photo", approved: false });
  live.db.files.set(`${id(n)}.png`, png(n));
}
live.db.originals.set(`${id(1)}.jpg`, jpg(1)); // guest 1 sent a photo; its original is kept too

// 1. first backup: everything, encrypted
console.log(await run("backup.mjs", [backup], env));
assert.ok(fs.existsSync(path.join(backup, "balloons.json.enc")));
assert.ok(fs.existsSync(path.join(backup, `images/${id(1)}.png.enc`)));
assert.ok(fs.existsSync(path.join(backup, `images/originals/${id(1)}.jpg.enc`)), "original photo backed up");
assert.ok(!fs.readFileSync(path.join(backup, "balloons.json.enc")).includes("Guest 1"), "names are not readable");

// 2. second backup after a new balloon: only the new picture is downloaded
live.db.rows.push({ id: id(3), created_at: "2026-10-13T10:00:00Z", name: "Guest 3", note: "x", image_path: `${id(3)}.png`, source: "drawn", approved: false });
live.db.files.set(`${id(3)}.png`, png(3));
live.db.downloads = 0;
console.log(await run("backup.mjs", [backup], env));
assert.equal(live.db.downloads, 1, "incremental");

// 3. someone deletes a balloon in Supabase: the backup keeps it
live.db.rows = live.db.rows.filter((r) => r.id !== id(2));
console.log(await run("backup.mjs", [backup], env));

// 4. Supabase is unreachable: the script fails and leaves the backup alone
const before = fs.readFileSync(path.join(backup, "balloons.json.enc"));
await assert.rejects(run("backup.mjs", [backup], { SUPABASE_URL: "http://127.0.0.1:9" }));
assert.ok(before.equals(fs.readFileSync(path.join(backup, "balloons.json.enc"))), "untouched on failure");

// 5. wrong passphrase is refused
await assert.rejects(run("decrypt-backup.mjs", [backup, path.join(tmp, "nope")], { BACKUP_PASSPHRASE: "wrong" }));

// 6. decrypt and check contents
const plain = path.join(tmp, "plain");
console.log(await run("decrypt-backup.mjs", [backup, plain], {}));
const saved = JSON.parse(fs.readFileSync(path.join(plain, "balloons.json"), "utf8"));
assert.equal(saved.length, 3);
assert.ok(saved.find((b) => b.id === id(2)).missing_since, "deleted balloon kept and marked");
assert.ok(fs.readFileSync(path.join(plain, `images/${id(2)}.png`)).equals(png(2)));
assert.ok(fs.readFileSync(path.join(plain, `images/originals/${id(1)}.jpg`)).equals(jpg(1)), "original photo decrypts");
assert.match(fs.readFileSync(path.join(plain, "balloons.csv"), "utf8"), /"Hello, ""you two"""/);

// 7. restore into an empty project, including the removed one
const fresh = await fakeSupabase();
console.log(await run("restore.mjs", [backup, "--include-removed"], { SUPABASE_URL: fresh.url }));
assert.equal(fresh.db.rows.length, 3);
assert.ok(fresh.db.files.get(`${id(3)}.png`).equals(png(3)));
assert.ok(fresh.db.originals.get(`${id(1)}.jpg`).equals(jpg(1)), "original photo restored");
// and running it again adds nothing twice
await run("restore.mjs", [backup, "--include-removed"], { SUPABASE_URL: fresh.url });
assert.equal(fresh.db.rows.length, 3);

// 8. a project without the originals bucket still backs up everything else
const older = await fakeSupabase();
older.db.noOriginals = true;
older.db.rows.push({ id: id(4), created_at: "2026-10-14T10:00:00Z", name: "Guest 4", note: "y", image_path: `${id(4)}.png`, source: "photo", approved: false });
older.db.files.set(`${id(4)}.png`, png(4));
const backup2 = path.join(tmp, "backup2");
console.log(await run("backup.mjs", [backup2], { SUPABASE_URL: older.url }));
assert.ok(fs.existsSync(path.join(backup2, `images/${id(4)}.png.enc`)));
older.server.close();

live.server.close();
fresh.server.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log("backup tests passed");
