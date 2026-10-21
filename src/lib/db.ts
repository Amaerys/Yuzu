// IndexedDB persistence. Everything is loaded into memory on start (collections of this size fit
// easily); IndexedDB is the durable copy, written in batches.
import type { Card, Note, Notetype, Review } from "./model";

const DB_NAME = "yuzu";
const DB_VERSION = 1;
export const STORES = ["notetypes", "notes", "cards", "reviews", "meta", "media"] as const;
export type StoreName = (typeof STORES)[number];

let dbp: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) {
        if (db.objectStoreNames.contains(s)) continue;
        const keyPath = s === "meta" ? "key" : s === "media" ? "name" : "id";
        const os = db.createObjectStore(s, { keyPath });
        if (s === "cards") { os.createIndex("nid", "nid"); os.createIndex("due", "due"); }
        if (s === "reviews") { os.createIndex("cid", "cid"); os.createIndex("ts", "ts"); }
        if (s === "notes") os.createIndex("ntid", "ntid");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("Database blocked by another tab"));
  });
  return dbp;
}

function tx(db: IDBDatabase, store: StoreName, mode: IDBTransactionMode) {
  return db.transaction(store, mode).objectStore(store);
}
const done = (t: IDBTransaction) => new Promise<void>((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });

export async function getAll<T>(store: StoreName): Promise<T[]> {
  const db = await openDb();
  return new Promise((res, rej) => {
    const r = tx(db, store, "readonly").getAll();
    r.onsuccess = () => res(r.result as T[]);
    r.onerror = () => rej(r.error);
  });
}
export async function getOne<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((res, rej) => {
    const r = tx(db, store, "readonly").get(key);
    r.onsuccess = () => res(r.result as T | undefined);
    r.onerror = () => rej(r.error);
  });
}
export async function putOne(store: StoreName, value: unknown): Promise<void> {
  const db = await openDb();
  const t = db.transaction(store, "readwrite");
  t.objectStore(store).put(value);
  await done(t);
}
export async function putMany(store: StoreName, values: unknown[], batch = 2000, onProgress?: (frac: number) => void): Promise<void> {
  const db = await openDb();
  for (let i = 0; i < values.length; i += batch) {
    const t = db.transaction(store, "readwrite");
    const os = t.objectStore(store);
    for (const v of values.slice(i, i + batch)) os.put(v);
    await done(t);
    onProgress?.(Math.min(1, (i + batch) / values.length));
  }
}
export async function deleteMany(store: StoreName, keys: IDBValidKey[]): Promise<void> {
  const db = await openDb();
  const t = db.transaction(store, "readwrite");
  for (const k of keys) t.objectStore(store).delete(k);
  await done(t);
}
export async function clearStore(store: StoreName): Promise<void> {
  const db = await openDb();
  const t = db.transaction(store, "readwrite");
  t.objectStore(store).clear();
  await done(t);
}
export async function clearAll(): Promise<void> { for (const s of STORES) await clearStore(s); }

export interface Snapshot { notetypes: Notetype[]; notes: Note[]; cards: Card[]; reviews: Review[] }
export async function loadSnapshot(): Promise<Snapshot> {
  const [notetypes, notes, cards, reviews] = await Promise.all([
    getAll<Notetype>("notetypes"), getAll<Note>("notes"), getAll<Card>("cards"), getAll<Review>("reviews"),
  ]);
  return { notetypes, notes, cards, reviews };
}
export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const r = await getOne<{ key: string; value: T }>("meta", key);
  return r ? r.value : fallback;
}
export async function setMeta(key: string, value: unknown): Promise<void> { await putOne("meta", { key, value }); }
