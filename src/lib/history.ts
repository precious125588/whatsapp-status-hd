// Conversion history stored on the user's device (IndexedDB), including the output videos.
export type HistoryItem = {
  id: string;
  date: number;
  source: string;
  sourceSize: number;
  sourceRes: string;
  outRes: string;
  parts: { name: string; size: number; blob: Blob }[];
};

const DB = "status-hd";
const STORE = "history";

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "id" });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((res, rej) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

export async function listHistory(): Promise<HistoryItem[]> {
  const all = await tx<HistoryItem[]>("readonly", (s) => s.getAll() as IDBRequest<HistoryItem[]>);
  return all.sort((a, b) => b.date - a.date);
}
export const addHistory = (item: HistoryItem) => tx("readwrite", (s) => s.put(item));
export const deleteHistory = (id: string) => tx("readwrite", (s) => s.delete(id));
export const clearHistory = () => tx("readwrite", (s) => s.clear());
