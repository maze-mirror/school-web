import type { Snapshot } from '@/core'
import type { ExportKind } from '@/platform/exporter'
import { snapshotCsv, snapshotJson, snapshotXlsx } from '@/platform/reports'

self.onmessage = async (event: MessageEvent<{ snapshot: Snapshot; kind: ExportKind }>) => {
  try {
    const { snapshot, kind } = event.data
    const content =
      kind === 'xlsx'
        ? await snapshotXlsx(snapshot)
        : kind === 'json'
          ? snapshotJson(snapshot)
          : snapshotCsv(snapshot)
    if (content instanceof ArrayBuffer)
      self.postMessage({ type: 'result', content }, { transfer: [content] })
    else self.postMessage({ type: 'result', content })
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : '报表生成失败',
    })
  }
}
