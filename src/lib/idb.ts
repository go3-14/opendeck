// Handoff store shared with background.js: the service worker writes a
// downloaded PPTX under a one-time key, the viewer reads and deletes it.

const DB_NAME = 'pptx_viewer'
const STORE_NAME = 'pptx_store'

export interface Handoff {
  filename?: string
  bytes?: ArrayBuffer
  timestamp?: number
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** Reads and deletes the record, so a handoff can only be opened once. */
export async function consumeHandoff(key: string): Promise<Handoff | undefined> {
  const db = await openDb()
  try {
    return await new Promise<Handoff | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const req = store.get(key)
      req.onsuccess = () => {
        store.delete(key)
        resolve(req.result)
      }
      req.onerror = () => reject(req.error)
    })
  } finally {
    db.close()
  }
}
