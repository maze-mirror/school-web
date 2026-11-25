import { analyzeText, summarize, type Source, type FileStat } from '@/core'
self.onmessage = (
  event: MessageEvent<{ sources: Source[]; rejected: FileStat[]; configKey: string }>,
) => {
  try {
    const { sources, rejected, configKey } = event.data
    const files = [...rejected]
    for (let i = 0; i < sources.length; i++) {
      self.postMessage({ type: 'progress', done: i, total: sources.length, path: sources[i]!.path })
      files.push(analyzeText(sources[i]!))
    }
    self.postMessage({
      type: 'progress',
      done: sources.length,
      total: sources.length,
      path: sources.at(-1)?.path ?? '',
    })
    self.postMessage({ type: 'result', result: summarize(files, configKey) })
  } catch (e) {
    self.postMessage({ type: 'error', message: e instanceof Error ? e.message : '分析失败' })
  }
}
