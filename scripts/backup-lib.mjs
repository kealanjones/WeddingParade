// Shared helpers for backup.mjs, restore.mjs and decrypt-backup.mjs.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const MAGIC = Buffer.from("SBPB1"); // Sop and Bop Parade Backup, v1

// AES-256-GCM with a key derived from the passphrase (scrypt, per-file salt).
export function encrypt(buf, passphrase) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(passphrase, salt, 32);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([MAGIC, salt, iv, c.getAuthTag(), body]);
}

export function decrypt(buf, passphrase) {
  if (!buf.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("Not an encrypted backup file");
  let o = MAGIC.length;
  const salt = buf.subarray(o, (o += 16));
  const iv = buf.subarray(o, (o += 12));
  const tag = buf.subarray(o, (o += 16));
  const key = crypto.scryptSync(passphrase, salt, 32);
  const d = crypto.createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  try {
    return Buffer.concat([d.update(buf.subarray(o)), d.final()]);
  } catch (e) {
    throw new Error("Could not decrypt: wrong passphrase, or the file is damaged");
  }
}

// Read/write a backup file, encrypted (".enc" added) when a passphrase is set.
export function writeFile(dir, name, data, passphrase) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const file = path.join(dir, passphrase ? name + ".enc" : name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, passphrase ? encrypt(buf, passphrase) : buf);
}

export function readFile(dir, name, passphrase) {
  const enc = path.join(dir, name + ".enc");
  if (fs.existsSync(enc)) {
    if (!passphrase) throw new Error(`${name} is encrypted: set BACKUP_PASSPHRASE`);
    return decrypt(fs.readFileSync(enc), passphrase);
  }
  const plain = path.join(dir, name);
  return fs.existsSync(plain) ? fs.readFileSync(plain) : null;
}

export function hasFile(dir, name) {
  return fs.existsSync(path.join(dir, name)) || fs.existsSync(path.join(dir, name + ".enc"));
}

// Supabase URL from the environment, or from site/config.js.
export function supabaseUrl() {
  if (process.env.SUPABASE_URL) return process.env.SUPABASE_URL.replace(/\/+$/, "");
  const cfg = fs.readFileSync(new URL("../site/config.js", import.meta.url), "utf8");
  const m = cfg.match(/supabaseUrl:\s*"([^"]+)"/);
  if (!m || m[1].includes("YOUR-PROJECT")) throw new Error("Set SUPABASE_URL");
  return m[1].replace(/\/+$/, "");
}

export function serviceHeaders(extra = {}) {
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!key) throw new Error("Set SUPABASE_SERVICE_KEY (Supabase: Project Settings -> API keys -> secret / service_role key)");
  const h = { apikey: key, ...extra };
  if (key.startsWith("eyJ")) h.Authorization = "Bearer " + key;
  return h;
}

export async function ok(res, what) {
  if (res.ok) return res;
  const body = await res.text().catch(() => "");
  throw new Error(`${what} failed (${res.status}): ${body.slice(0, 300)}`);
}
