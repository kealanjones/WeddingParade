// Back up every balloon (details and pictures) from Supabase into a folder.
//
//   SUPABASE_SERVICE_KEY=... BACKUP_PASSPHRASE=... node scripts/backup.mjs [folder]
//
// - Incremental: pictures already in the folder are not downloaded again.
// - Never forgets: a balloon that disappears from Supabase stays in the
//   backup, marked with "missing_since".
// - With BACKUP_PASSPHRASE set, every file is encrypted (AES-256-GCM).
// Exits with an error (and leaves the folder untouched) if Supabase can't be
// read, so a scheduled run shows up as failed.
import fs from "node:fs";
import path from "node:path";
import { writeFile, readFile, hasFile, supabaseUrl, serviceHeaders, ok } from "./backup-lib.mjs";

const out = path.resolve(process.argv[2] || process.env.OUT || "balloon-backup");
const pass = process.env.BACKUP_PASSPHRASE || "";
if (process.env.GITHUB_ACTIONS && !pass) {
  console.error("Refusing to write an unencrypted backup in GitHub Actions: set the BACKUP_PASSPHRASE secret.");
  process.exit(1);
}
const base = supabaseUrl();
const now = new Date().toISOString();

async function getJson(url, what) {
  const res = await ok(await fetch(url, { headers: serviceHeaders() }), what);
  return res.json();
}

async function listImages() {
  const names = [];
  for (let offset = 0; ; offset += 1000) {
    const res = await ok(
      await fetch(`${base}/storage/v1/object/list/balloons`, {
        method: "POST",
        headers: serviceHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ prefix: "", limit: 1000, offset, sortBy: { column: "name", order: "asc" } }),
      }),
      "Listing pictures"
    );
    const page = await res.json();
    for (const o of page) if (o.name && o.id) names.push(o.name);
    if (page.length < 1000) break;
  }
  return names;
}

// 1. read everything first; any failure stops before touching the folder
const rows = await getJson(`${base}/rest/v1/balloons?select=*&order=created_at.asc`, "Reading balloons");
let archive = null;
try {
  archive = await getJson(`${base}/rest/v1/balloons_archive?select=*&order=archive_id.asc`, "Reading archive");
} catch (e) {
  console.warn("No archive table yet (run the 20261012 migration):", e.message.split("\n")[0]);
}
const stored = await listImages();

// 2. merge with what the backup already knows
fs.mkdirSync(out, { recursive: true });
const prev = JSON.parse(readFile(out, "balloons.json", pass) || "[]");
const byId = new Map(prev.map((b) => [b.id, b]));
const seen = new Set();
for (const r of rows) {
  seen.add(r.id);
  const old = byId.get(r.id) || { first_backed_up: now };
  byId.set(r.id, { ...old, ...r, last_seen: now, missing_since: undefined });
}
for (const [id, b] of byId) if (!seen.has(id) && !b.missing_since) b.missing_since = now;
const all = [...byId.values()].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));

// 3. pictures: anything in storage or referenced by a row, not yet saved
const wanted = new Set([...stored, ...all.map((b) => b.image_path).filter(Boolean)]);
let fetched = 0, failed = 0;
for (const name of wanted) {
  if (!/^[\w.-]+$/.test(name)) continue;
  if (hasFile(out, path.join("images", name))) continue;
  const res = await fetch(`${base}/storage/v1/object/balloons/${encodeURIComponent(name)}`, { headers: serviceHeaders() });
  if (!res.ok) {
    failed++;
    console.warn(`Could not download ${name} (${res.status})`);
    continue;
  }
  writeFile(out, path.join("images", name), Buffer.from(await res.arrayBuffer()), pass);
  fetched++;
}

// 4. details, as JSON (for restoring) and CSV (for reading)
writeFile(out, "balloons.json", JSON.stringify(all, null, 2), pass);
if (archive) writeFile(out, "archive.json", JSON.stringify(archive, null, 2), pass);
const csvCell = (v) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const cols = ["created_at", "name", "note", "source", "approved", "image_path", "id", "missing_since"];
writeFile(out, "balloons.csv", [cols.join(","), ...all.map((b) => cols.map((c) => csvCell(b[c])).join(","))].join("\n") + "\n", pass);

const missing = all.filter((b) => b.missing_since).length;
fs.writeFileSync(
  path.join(out, "README.txt"),
  [
    "Sop and Bop's Wedding Balloon Parade - backup",
    `Last backup: ${now}`,
    `Balloons: ${all.length} (${missing} no longer in Supabase, kept here)`,
    `Pictures: ${[...wanted].length}`,
    pass ? "Files ending .enc are encrypted. Decrypt with: BACKUP_PASSPHRASE=... node scripts/decrypt-backup.mjs <this folder> <output folder>" : "Files are not encrypted.",
    "Restore into Supabase with: node scripts/restore.mjs <folder>  (see README)",
    "",
  ].join("\n")
);
console.log(`Backed up ${all.length} balloons (${rows.length} live, ${missing} kept after removal), ${fetched} new pictures${failed ? `, ${failed} failed` : ""} -> ${out}`);
if (failed) process.exitCode = 1;
