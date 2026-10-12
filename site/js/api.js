// Tiny Supabase client over REST + Storage, using fetch.
(function () {
  const cfg = window.PARADE_CONFIG;
  const base = cfg.supabaseUrl.replace(/\/+$/, "");
  const key = cfg.supabaseAnonKey;

  function headers(extra) {
    const h = { apikey: key, ...extra };
    // Legacy anon keys are JWTs and also go in Authorization;
    // new publishable keys (sb_publishable_...) only go in apikey.
    if (key.startsWith("eyJ")) h.Authorization = "Bearer " + key;
    return h;
  }

  async function check(res, what) {
    if (res.ok) return res;
    let detail = "";
    try { detail = await res.text(); } catch (e) {}
    throw new Error(what + " failed (" + res.status + "): " + detail.slice(0, 200));
  }

  function newId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }

  // "Already there" from an earlier attempt counts as success, so a retry
  // with the same id never makes a duplicate balloon.
  async function alreadyThere(res) {
    if (res.status !== 409 && res.status !== 400) return false;
    const text = await res.clone().text().catch(() => "");
    return /duplicate|already exists|23505/i.test(text);
  }

  async function sendOnce({ id, blob, name, note, source }) {
    const path = id + ".png";
    const up = await fetch(base + "/storage/v1/object/balloons/" + path, {
      method: "POST",
      headers: headers({ "Content-Type": "image/png", "x-upsert": "false" }),
      body: blob,
    });
    if (!(await alreadyThere(up))) await check(up, "Uploading your balloon");
    const row = await fetch(base + "/rest/v1/balloons", {
      method: "POST",
      headers: headers({ "Content-Type": "application/json", Prefer: "return=minimal" }),
      body: JSON.stringify({ id, name, note: note || null, image_path: path, source }),
    });
    if (!(await alreadyThere(row))) await check(row, "Saving your details");
    return { id, path };
  }

  // Tries a few times with a pause, for wobbly phone signal.
  async function submitBalloon(balloon) {
    const b = { ...balloon, id: balloon.id || newId() };
    let lastErr;
    for (const wait of [0, 1500, 4000]) {
      if (wait) await new Promise((r) => setTimeout(r, wait));
      try {
        return await sendOnce(b);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  }

  async function approvedBalloons() {
    const res = await check(
      await fetch(base + "/rest/v1/balloons?select=id,name,note,image_path,created_at&approved=eq.true&order=created_at.asc", {
        headers: headers(),
      }),
      "Loading balloons"
    );
    return res.json();
  }

  async function balloonCount() {
    const res = await check(
      await fetch(base + "/rest/v1/rpc/balloon_count", {
        method: "POST",
        headers: headers({ "Content-Type": "application/json" }),
        body: "{}",
      }),
      "Counting balloons"
    );
    return res.json();
  }

  function imageUrl(path) {
    return base + "/storage/v1/object/public/balloons/" + encodeURIComponent(path);
  }

  window.ParadeApi = { submitBalloon, approvedBalloons, balloonCount, imageUrl, newId };
})();
