// A tiny store for sound recordings and imported files, so a session keeps
// its audio after RICO restarts. Everything stays on this computer.

const DB = 'rico-sound'
const STORE = 'buffers'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => r.result.createObjectStore(STORE)
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}

export interface StoredSound { rate: number; channels: Float32Array[] }

export async function putSound(id: string, s: StoredSound): Promise<void> {
  try {
    const db = await open()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(s, id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch { /* storage not available: the sound lives until RICO closes */ }
}

export async function getSound(id: string): Promise<StoredSound | null> {
  try {
    const db = await open()
    return await new Promise((resolve) => {
      const r = db.transaction(STORE).objectStore(STORE).get(id)
      r.onsuccess = () => resolve((r.result as StoredSound | undefined) ?? null)
      r.onerror = () => resolve(null)
    })
  } catch { return null }
}

export async function deleteSounds(keep: Set<string>): Promise<void> {
  try {
    const db = await open()
    const tx = db.transaction(STORE, 'readwrite')
    const st = tx.objectStore(STORE)
    const r = st.getAllKeys()
    r.onsuccess = () => { for (const k of r.result) if (!keep.has(String(k))) st.delete(k) }
  } catch { /* fine */ }
}
