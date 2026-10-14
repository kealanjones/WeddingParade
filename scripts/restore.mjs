// Put balloons from a backup folder back into Supabase (this project, or a
// brand new one after running the migrations).
//
//   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... BACKUP_PASSPHRASE=... node scripts/restore.mjs <folder>
//
// Only adds what is missing; existing balloons are left alone. Add
// --include-removed to also bring back balloons that were deleted on purpose.
import fs from "node:fs";
import path from "node:path";
import { readFile, supabaseUrl, serviceHeaders, ok } from "./backup-lib.mjs";

const dir = path.resolve(process.argv.filter((a) => !a.startsWith("--"))[2] || "balloon-backup");
const includeRemoved = process.argv.includes("--include-removed");
const pass = process.env.BACKUP_PASSPHRASE || "";
const base = supabaseUrl();

const all = JSON.parse(readFile(dir, "balloons.json", pass) || "[]");
const list = all.filter((b) => includeRemoved || !b.missing_since);
let pics = 0, rows = 0;
for (const b of list) {
  const img = readFile(dir, path.join("images", b.image_path), pass);
  if (img) {
    const res = await fetch(`${base}/storage/v1/object/balloons/${encodeURIComponent(b.image_path)}`, {
      method: "POST",
      headers: serviceHeaders({ "Content-Type": "image/png", "x-upsert": "true" }),
      body: img,
    });
    await ok(res, `Uploading ${b.image_path}`);
    pics++;
  } else {
    console.warn(`No picture in the backup for ${b.name} (${b.image_path})`);
  }
  const row = { id: b.id, created_at: b.created_at, name: b.name, note: b.note, image_path: b.image_path, source: b.source, approved: !!b.approved };
  const res = await fetch(`${base}/rest/v1/balloons?on_conflict=id`, {
    method: "POST",
    headers: serviceHeaders({ "Content-Type": "application/json", Prefer: "resolution=ignore-duplicates,return=minimal" }),
    body: JSON.stringify(row),
  });
  await ok(res, `Restoring ${b.name}`);
  rows++;
}
// guests' original photos, back into the private "originals" bucket
let originals = 0;
const origDir = path.join(dir, "images", "originals");
if (fs.existsSync(origDir)) {
  for (const f of fs.readdirSync(origDir)) {
    const name = f.replace(/\.enc$/, "");
    if (!/^[\w.-]+$/.test(name)) continue;
    const data = readFile(dir, path.join("images", "originals", name), pass);
    if (!data) continue;
    const res = await fetch(`${base}/storage/v1/object/originals/${encodeURIComponent(name)}`, {
      method: "POST",
      headers: serviceHeaders({ "Content-Type": "image/jpeg", "x-upsert": "true" }),
      body: data,
    });
    await ok(res, `Uploading original ${name}`);
    originals++;
  }
}
console.log(`Restored ${rows} balloons, ${pics} pictures and ${originals} original photos into ${base}`);
