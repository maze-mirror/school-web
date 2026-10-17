import { emptyCounts, type FileStat, type Source, type Language } from '@/core'
export const LIMITS = {
  maxFileBytes: 5 * 1024 * 1024,
  maxTotalBytes: 40 * 1024 * 1024,
  maxFiles: 2000,
}
export const DEFAULT_EXCLUSIONS = ['.git', 'node_modules', 'dist', 'build', '__pycache__', '.venv']
export function filePath(file: File): string {
  return file.webkitRelativePath || file.name
}
export async function readSources(
  files: File[],
  exclusions: string[],
  language?: Language,
): Promise<{ sources: Source[]; rejected: FileStat[] }> {
  const isExcluded = (file: File) =>
    filePath(file)
      .split(/[\\/]/)
      .some((part) => exclusions.includes(part))
  const candidates = files.filter((file) => !isExcluded(file))
  if (candidates.length > LIMITS.maxFiles) throw new Error('排除目录后最多处理 2000 个文件')
  if (candidates.reduce((n, f) => n + f.size, 0) > LIMITS.maxTotalBytes)
    throw new Error('排除目录后文件总量超过 40 MB，请缩小目录范围')
  const sources: Source[] = [],
    rejected: FileStat[] = [],
    seen = new Set<string>()
  for (const file of files) {
    const path = filePath(file)
    const fail = (reason: string, status: 'error' | 'skipped' = 'error') =>
      rejected.push({ path, language: null, status, counts: emptyCounts(), reason, warnings: [] })
    if (seen.has(path)) {
      fail('相对路径重复，保留第一份；请分别扫描不同目录。')
      continue
    }
    seen.add(path)
    if (path.split(/[\\/]/).some((part) => exclusions.includes(part))) {
      fail('匹配排除目录', 'skipped')
      continue
    }
    if (file.size > LIMITS.maxFileBytes) {
      fail('单文件超过 5 MB')
      continue
    }
    try {
      const bytes = await file.arrayBuffer()
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      sources.push({ path, text, language })
    } catch {
      fail('读取或 UTF-8 解码失败；请转换编码后重试。')
    }
  }
  return { sources, rejected }
}
