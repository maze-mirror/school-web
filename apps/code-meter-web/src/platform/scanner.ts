import type { Source, FileStat, ScanResult } from '@/core'

function detail(error: unknown): string {
  return error instanceof Error ? error.message : String(error || '浏览器未提供具体错误')
}
export function startScan(
  sources: Source[],
  rejected: FileStat[],
  configKey: string,
  onProgress: (done: number, total: number, path: string) => void,
) {
  let worker: Worker | undefined
  let settled = false
  let rejectTask: (reason: Error) => void = () => {}
  const promise = new Promise<ScanResult>((resolve, reject) => {
    const fail = (message: string) => {
      if (settled) return
      settled = true
      worker?.terminate()
      reject(new Error(message))
    }
    rejectTask = (reason) => fail(reason.message)
    try {
      worker = new Worker(new URL('../workers/scan.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (e) => {
        if (settled) return
        if (e.data?.type === 'progress') onProgress(e.data.done, e.data.total, e.data.path ?? '')
        else if (e.data?.type === 'result') {
          settled = true
          worker?.terminate()
          resolve(e.data.result)
        } else fail('代码分析失败：' + (e.data?.message || '统计线程返回了无法识别的消息'))
      }
      worker.onerror = (event) => {
        const location = event.filename ? '（' + event.filename + ':' + event.lineno + '）' : ''
        fail(
          '统计引擎运行失败。请确认开发服务仍在运行，按 Ctrl+Shift+R 刷新后重试。错误详情：' +
            (event.message || '后台线程加载或执行失败，浏览器未提供具体原因') +
            location,
        )
      }
      worker.onmessageerror = () => fail('统计结果传输失败，请刷新页面后重试。')
      worker.postMessage({ sources, rejected, configKey })
    } catch (error) {
      fail('统计引擎启动或输入传输失败：' + detail(error))
    }
  })
  return {
    promise,
    cancel() {
      rejectTask(new Error('统计已取消'))
    },
  }
}
