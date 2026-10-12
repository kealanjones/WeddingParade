// Balloons waiting to be sent, kept on the guest's own device (IndexedDB)
// until Supabase confirms them, so a dropped connection or closed tab
// never loses a balloon. Every call fails quietly if storage is blocked.
(function () {
  const DB = "parade-outbox", STORE = "balloons";

  function open() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error("no indexedDB"));
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function run(mode, fn) {
    try {
      const db = await open();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const result = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(result && "result" in result ? result.result : undefined);
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) {
      return undefined;
    }
  }

  window.Outbox = {
    put: (balloon) => run("readwrite", (s) => s.put({ ...balloon, savedAt: Date.now() })),
    remove: (id) => run("readwrite", (s) => s.delete(id)),
    all: async () => (await run("readonly", (s) => s.getAll())) || [],
  };
})();
