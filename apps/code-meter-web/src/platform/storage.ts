import type { Snapshot } from '@/core'
const DB_NAME = 'school-code-meter-v1'
async function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains('snapshots'))
        req.result.createObjectStore('snapshots', { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('无法打开浏览器存储'))
    req.onblocked = () => reject(new Error('另一个标签页阻止了数据库升级，请关闭后重试'))
  })
}
export async function listSnapshots(): Promise<Snapshot[]> {
  const db = await openDb()
  try {
    return await new Promise((resolve, reject) => {
      const req = db.transaction('snapshots').objectStore('snapshots').getAll()
      req.onsuccess = () =>
        resolve(
          (req.result as Snapshot[]).sort(
            (a, b) => Date.parse(b.scannedAt) - Date.parse(a.scannedAt),
          ),
        )
      req.onerror = () => reject(req.error)
    })
  } finally {
    db.close()
  }
}
export async function saveSnapshot(snapshot: Snapshot): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('snapshots', 'readwrite')
      tx.objectStore('snapshots').put(snapshot)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error ?? new Error('保存已中止'))
    })
  } finally {
    db.close()
  }
}
export async function deleteSnapshot(id: string): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('snapshots', 'readwrite')
      tx.objectStore('snapshots').delete(id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error ?? new Error('删除已中止'))
    })
  } finally {
    db.close()
  }
}
export function downloadFile(name: string, content: string | ArrayBuffer, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export { snapshotCsv, snapshotJson, snapshotXlsx } from './reports'
