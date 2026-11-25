import {
  detectLanguage,
  emptyCounts,
  supportedLanguageNames,
  type FileStat,
  type Source,
} from '@/core'

export const LIMITS = {
  maxFileBytes: 5 * 1024 * 1024,
  maxTotalBytes: 40 * 1024 * 1024,
  maxFiles: 5000,
}
export type FileEncoding = 'utf-8' | 'utf-8-gbk' | 'gbk'
export interface ReadProgress {
  done: number
  total: number
  path: string
}

function abortError() {
  return new DOMException('读取已取消', 'AbortError')
}

/** Abort the native reader; alternate file adapters must discard any late read result. */
function readFile(file: File, signal?: AbortSignal): Promise<ArrayBuffer> {
  if (signal?.aborted) return Promise.reject(abortError())
  return new Promise((resolve, reject) => {
    const reader =
      typeof FileReader !== 'undefined' && file instanceof Blob ? new FileReader() : null
    const cleanup = () => signal?.removeEventListener('abort', abort)
    const abort = () => {
      cleanup()
      reader?.abort()
      reject(abortError())
    }
    signal?.addEventListener('abort', abort, { once: true })
    const finish = (value: ArrayBuffer) => {
      cleanup()
      if (signal?.aborted) reject(abortError())
      else resolve(value)
    }
    const fail = (error: unknown) => {
      cleanup()
      reject(error)
    }
    if (reader) {
      reader.onload = () => finish(reader.result as ArrayBuffer)
      reader.onerror = () => fail(reader.error)
      reader.onabort = () => fail(abortError())
      try {
        reader.readAsArrayBuffer(file)
      } catch (error) {
        fail(error)
      }
    } else {
      // Used by non-browser file adapters as well as the native FileReader path above.
      Promise.resolve()
        .then(() => {
          signal?.throwIfAborted()
          return file.arrayBuffer()
        })
        .then(finish, fail)
    }
  })
}
export const DEFAULT_EXCLUSIONS = ['.git', 'node_modules', 'dist', 'build', '__pycache__', '.venv']
export function filePath(file: File): string {
  return file.webkitRelativePath || file.name
}
export function parseExclusions(value: string): string[] {
  return [
    ...new Set(
      value
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  ].sort()
}

/** The same unique, supported, non-excluded sources drive preview, quotas and reading. */
export function prepareFiles(files: File[], exclusions: string[]) {
  const candidates: File[] = []
  const rejected: FileStat[] = []
  const seen = new Set<string>()
  for (const file of files) {
    const path = filePath(file)
    const reject = (reason: string, status: 'error' | 'skipped' = 'skipped') =>
      rejected.push({
        path,
        language: null,
        status,
        counts: emptyCounts(),
        reason,
        warnings: [],
      })
    if (path.split(/[\\/]/).some((part) => exclusions.includes(part))) {
      reject('匹配排除目录')
    } else if (!detectLanguage(path)) {
      reject('暂不支持此后缀；当前支持 ' + supportedLanguageNames() + '。')
    } else {
      const key = path.replace(/\\/g, '/')
      if (seen.has(key)) reject('相对路径重复，保留第一份；请分别扫描不同目录。', 'error')
      else {
        seen.add(key)
        candidates.push(file)
      }
    }
  }
  return {
    candidates,
    rejected,
    totalBytes: candidates.reduce((sum, file) => sum + file.size, 0),
  }
}

export async function readSources(
  files: File[],
  exclusions: string[],
  encoding: FileEncoding = 'utf-8',
  options: { signal?: AbortSignal; onProgress?: (progress: ReadProgress) => void } = {},
): Promise<{ sources: Source[]; rejected: FileStat[] }> {
  const { signal, onProgress } = options
  signal?.throwIfAborted()
  const { candidates, rejected, totalBytes } = prepareFiles(files, exclusions)
  if (candidates.length > LIMITS.maxFiles)
    throw new Error(
      `候选源文件 ${candidates.length} 个，超过 ${LIMITS.maxFiles} 个上限；请排除不需要的目录或分次扫描`,
    )
  if (totalBytes > LIMITS.maxTotalBytes)
    throw new Error('候选源文件总量超过 40 MB，请排除不需要的目录或分次扫描')
  const sources: Source[] = []
  onProgress?.({ done: 0, total: candidates.length, path: '' })
  for (let index = 0; index < candidates.length; index++) {
    // Yield between groups even for immediately resolved adapters or rejected files.
    if (index > 0 && index % 25 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0))
    signal?.throwIfAborted()
    const file = candidates[index]!
    const path = filePath(file)
    onProgress?.({ done: index, total: candidates.length, path })
    const fail = (reason: string) =>
      rejected.push({
        path,
        language: detectLanguage(path),
        status: 'error',
        counts: emptyCounts(),
        reason,
        warnings: [],
      } as FileStat)
    try {
      if (file.size > LIMITS.maxFileBytes) {
        fail('单文件超过 5 MB')
        continue
      }
      let bytes: ArrayBuffer
      try {
        bytes = await readFile(file, signal)
      } catch {
        signal?.throwIfAborted()
        fail('文件读取失败；请确认文件仍可访问后重新选择。')
        continue
      }
      signal?.throwIfAborted()
      if (new Uint8Array(bytes).includes(0)) {
        fail('内容含二进制空字符，未按源代码统计；不适用 UTF-8 / GBK 转编码。')
        continue
      }
      let decoded: Source['encoding'] = encoding === 'gbk' ? 'gbk' : 'utf-8'
      try {
        let text: string
        try {
          text = new TextDecoder(decoded, { fatal: true }).decode(bytes)
        } catch (error) {
          if (encoding !== 'utf-8-gbk') throw error
          decoded = 'gbk'
          text = new TextDecoder('gbk', { fatal: true }).decode(bytes)
        }
        sources.push({ path, text, encoding: decoded })
      } catch {
        fail(
          encoding === 'utf-8'
            ? 'UTF-8 解码失败；若确认原文件为 GBK，请在文件编码中选择“UTF-8 优先，失败按 GBK”后重试；也可在编辑器中以 GBK 打开并另存为 UTF-8。'
            : '按所选编码解码失败；请在编辑器中确认原编码并另存为 UTF-8，再选择 UTF-8 重试。',
        )
      }
    } finally {
      if (!signal?.aborted) onProgress?.({ done: index + 1, total: candidates.length, path })
    }
  }
  return { sources, rejected }
}
