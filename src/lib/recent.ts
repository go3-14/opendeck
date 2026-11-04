// Recently opened presentations, kept on this device only (IndexedDB), so a
// file can be reopened without finding it again. File bytes live in their own
// store so listing the recent files never loads them.

const DB_NAME = 'pptx_recent'
const META = 'meta'
const BYTES = 'bytes'

export const MAX_RECENT = 5
const MAX_FILE_BYTES = 60 * 1024 * 1024 // larger files are not kept
const MAX_TOTAL_BYTES = 200 * 1024 * 1024

export interface RecentEntry {
  id: string
  name: string
  size: number
  openedAt: number
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(META, { keyPath: 'id' })
      req.result.createObjectStore(BYTES)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })

const request = <T,>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })

/** Newest first. */
export async function listRecent(): Promise<RecentEntry[]> {
  const db = await openDb()
  try {
    const all = await request(db.transaction(META).objectStore(META).getAll() as IDBRequest<RecentEntry[]>)
    return all.sort((a, b) => b.openedAt - a.openedAt)
  } finally {
    db.close()
  }
}

/** Remembers a file (replacing an earlier entry of the same name and size). Returns false if too large. */
export async function addRecent(name: string, bytes: ArrayBuffer): Promise<boolean> {
  if (bytes.byteLength > MAX_FILE_BYTES) return false
  const db = await openDb()
  try {
    const existing = await request(db.transaction(META).objectStore(META).getAll() as IDBRequest<RecentEntry[]>)
    const same = existing.find((e) => e.name === name && e.size === bytes.byteLength)
    const entry: RecentEntry = {
      id: same?.id ?? crypto.randomUUID(),
      name,
      size: bytes.byteLength,
      openedAt: Date.now(),
    }

    // Keep the newest few that fit the size budget; drop the rest.
    const keep = [entry, ...existing.filter((e) => e.id !== entry.id).sort((a, b) => b.openedAt - a.openedAt)]
    let total = 0
    const kept = keep.filter((e, i) => {
      total += e.size
      return i < MAX_RECENT && total <= MAX_TOTAL_BYTES
    })
    const dropped = keep.filter((e) => !kept.includes(e))

    const tx = db.transaction([META, BYTES], 'readwrite')
    tx.objectStore(META).put(entry)
    tx.objectStore(BYTES).put(bytes, entry.id)
    for (const e of dropped) {
      tx.objectStore(META).delete(e.id)
      tx.objectStore(BYTES).delete(e.id)
    }
    await done(tx)
    return true
  } finally {
    db.close()
  }
}

export async function loadRecent(id: string): Promise<ArrayBuffer | undefined> {
  const db = await openDb()
  try {
    return await request(db.transaction(BYTES).objectStore(BYTES).get(id) as IDBRequest<ArrayBuffer | undefined>)
  } finally {
    db.close()
  }
}

export async function clearRecent(): Promise<void> {
  const db = await openDb()
  try {
    const tx = db.transaction([META, BYTES], 'readwrite')
    tx.objectStore(META).clear()
    tx.objectStore(BYTES).clear()
    await done(tx)
  } finally {
    db.close()
  }
}
