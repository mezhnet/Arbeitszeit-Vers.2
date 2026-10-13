// Speicherung in IndexedDB – nur lokal auf dem Gerät, kein Server.
// Jede Änderung wird sofort mit durability "strict" geschrieben: Der Browser meldet erst
// "fertig", wenn die Daten auf dem Speicher liegen (wichtig, falls der Akku leer geht).

// Eindeutiger Name: Alle Apps unter <name>.github.io teilen sich denselben Browserspeicher.
const DB_NAME = 'arbeitszeit-gleitzeit-v1';
const DB_VERSION = 1;
const DAYS = 'days';
const META = 'meta';

let dbPromise = null;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(DAYS)) db.createObjectStore(DAYS, { keyPath: 'date' });
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Die Datenbank ist blockiert. Bitte andere Fenster der App schließen.'));
    }).catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

function finished(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Speichern abgebrochen.'));
  });
}

async function write(stores, fill) {
  const db = await open();
  const tx = db.transaction(stores, 'readwrite', { durability: 'strict' });
  fill(tx);
  await finished(tx);
}

/** Lädt alle Tage und die Einstellungen. */
export async function loadAll() {
  const db = await open();
  const tx = db.transaction([DAYS, META], 'readonly');
  const daysReq = tx.objectStore(DAYS).getAll();
  const settingsReq = tx.objectStore(META).get('settings');
  await finished(tx);
  const days = {};
  for (const d of daysReq.result) days[d.date] = d;
  return { days, settings: settingsReq.result ?? null };
}

export const saveDay = (day) => write([DAYS], (tx) => tx.objectStore(DAYS).put(day));

export const deleteDay = (date) => write([DAYS], (tx) => tx.objectStore(DAYS).delete(date));

export const saveSettings = (settings) => write([META], (tx) => tx.objectStore(META).put(settings, 'settings'));

/** Ersetzt alle Daten in einer einzigen Transaktion (Wiederherstellen, Alles löschen). */
export const replaceAll = (days, settings) =>
  write([DAYS, META], (tx) => {
    const store = tx.objectStore(DAYS);
    store.clear();
    for (const d of Object.values(days)) store.put(d);
    tx.objectStore(META).put(settings, 'settings');
  });
