// Turn an encrypted backup folder into normal files you can open.
//
//   BACKUP_PASSPHRASE=... node scripts/decrypt-backup.mjs <backup folder> <output folder>
import fs from "node:fs";
import path from "node:path";
import { decrypt } from "./backup-lib.mjs";

const [src, dst] = process.argv.slice(2).map((p) => p && path.resolve(p));
const pass = process.env.BACKUP_PASSPHRASE;
if (!src || !dst || !pass) {
  console.error("Usage: BACKUP_PASSPHRASE=... node scripts/decrypt-backup.mjs <backup folder> <output folder>");
  process.exit(1);
}
let n = 0;
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git") continue;
    const from = path.join(dir, e.name);
    if (e.isDirectory()) { walk(from); continue; }
    const rel = path.relative(src, from);
    const to = path.join(dst, rel.replace(/\.enc$/, ""));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, e.name.endsWith(".enc") ? decrypt(fs.readFileSync(from), pass) : fs.readFileSync(from));
    n++;
  }
})(src);
console.log(`Decrypted ${n} files into ${dst}`);
