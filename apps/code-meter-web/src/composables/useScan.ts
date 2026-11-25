import {
  computed,
  onBeforeUnmount,
  ref,
  type ComputedRef,
  type Ref,
  type UnwrapNestedRefs,
} from 'vue'
import { LANGUAGES, RULE_VERSION, type Language, type Snapshot } from '@/core'
import {
  DEFAULT_EXCLUSIONS,
  LIMITS,
  parseExclusions,
  readSources,
  type FileEncoding,
} from '@/platform/files'
import { startScan } from '@/platform/scanner'
import type { Project } from './useProjects'
import { errorText } from '@/utils/format'

export function useScan(options: {
  project: ComputedRef<Project | undefined>
  notice: Ref<string>
  save: (snapshot: Snapshot) => Promise<void>
  refreshToday: () => void
  hasDisplay: () => boolean
}) {
  const { project, notice, save, refreshToday, hasDisplay } = options
  const mode = ref<'files' | 'text'>('files')
  const selectedFiles = ref<File[]>([])
  const text = ref('')
  const language = ref<Language>('python')
  const encoding = ref<FileEncoding>('utf-8')
  const exclusions = ref(DEFAULT_EXCLUSIONS.join(', '))
  const current = ref<Snapshot | null>(null)
  const saveState = ref('')
  const busy = ref(false)
  const progress = ref(0)
  const phase = ref('')
  const currentFile = ref('')
  const processed = ref(0)
  const fileTotal = ref(0)
  let reading: AbortController | null = null
  let running: ReturnType<typeof startScan> | null = null
  let scanToken = 0
  const canScan = computed(
    () =>
      !!project.value &&
      !busy.value &&
      (mode.value === 'files' ? selectedFiles.value.length > 0 : text.value.length > 0),
  )
  function addFiles(files: File[]) {
    if (busy.value) return
    selectedFiles.value.push(...files)
    notice.value = `已选择 ${selectedFiles.value.length} 个文件；重复路径将在统计时列出。`
  }

  function clearText() {
    if (busy.value) return
    text.value = ''
    notice.value = ''
  }
  function demo() {
    mode.value = 'text'
    language.value = 'python'
    text.value =
      '# A small example\nname = "# is part of a string"\n\n"""Documentation stays code.\n\nOne physical line at a time.\n"""\nprint(name)  # inline comment\n'
    notice.value = '已填入可编辑的 Python 示例。统计后会保存为真实扫描记录。'
  }

  async function scan() {
    if (!canScan.value) return
    refreshToday()
    const token = ++scanToken
    busy.value = true
    progress.value = 0
    phase.value = '读取输入'
    currentFile.value = ''
    processed.value = 0
    fileTotal.value = 0
    notice.value = ''
    saveState.value = ''
    const p = project.value!
    const readController = new AbortController()
    reading = readController
    try {
      const excluded = parseExclusions(exclusions.value)
      if (
        mode.value === 'text' &&
        new TextEncoder().encode(text.value).length > LIMITS.maxFileBytes
      )
        throw new Error('粘贴文本超过 5 MB')
      const input =
        mode.value === 'files'
          ? await readSources(selectedFiles.value, excluded, encoding.value, {
              signal: readController.signal,
              onProgress: ({ done, total, path }) => {
                if (token !== scanToken) return
                processed.value = done
                fileTotal.value = total
                currentFile.value = path
                progress.value = total ? Math.round((done / total) * 100) : 100
              },
            })
          : {
              sources: [
                {
                  path: `snippet.${LANGUAGES.find((l) => l.id === language.value)!.extensions[0]}`,
                  text: text.value,
                  language: language.value,
                },
              ],
              rejected: [],
            }
      if (token !== scanToken) return
      phase.value = '分析代码'
      progress.value = 0
      processed.value = 0
      fileTotal.value = input.sources.length
      currentFile.value = input.sources[0]?.path ?? ''
      const configKey = JSON.stringify({
        rule: RULE_VERSION,
        exclusions: excluded,
        override: mode.value === 'text' ? language.value : null,
        encoding: mode.value === 'files' ? encoding.value : null,
        pythonDocstrings: 'code',
      })
      running = startScan(input.sources, input.rejected, configKey, (done, total, path) => {
        if (token !== scanToken) return
        progress.value = total ? Math.round((done / total) * 100) : 100
        processed.value = done
        fileTotal.value = total
        currentFile.value = path
      })
      const result = await running.promise
      if (token !== scanToken) return
      const snapshot: Snapshot = {
        ...result,
        id: crypto.randomUUID(),
        projectId: p.id,
        projectName: p.name,
        scannedAt: new Date().toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }
      current.value = snapshot
      progress.value = 100
      refreshToday()
      if (!result.files.some((f) => f.status === 'ok')) {
        saveState.value = '无成功文件，未计入活动'
        notice.value = '没有可统计的文件，请查看明细中的原因。'
        return
      }
      phase.value = '保存快照'
      currentFile.value = ''
      try {
        await save(snapshot)
        saveState.value = '已保存到此浏览器'
        const success = result.files.filter((file) => file.status === 'ok').length
        const errors = result.files.filter((file) => file.status === 'error').length
        const skipped = result.files.length - success - errors
        notice.value = `统计完成：成功 ${success}，失败 ${errors}，跳过 ${skipped}。${errors ? '结果仅包含成功文件，请查看失败原因。' : ''}项目总量使用本次快照，不累加重复扫描。`
      } catch (e) {
        saveState.value = '保存失败，可导出备份'
        notice.value = `统计已完成，但历史未保存：${errorText(e)}`
      }
    } catch (e) {
      if (token === scanToken) {
        notice.value = errorText(e)
        if (hasDisplay()) saveState.value = '本次统计失败，当前显示上次结果'
      }
    } finally {
      if (token === scanToken) {
        busy.value = false
        running = null
        reading = null
        phase.value = ''
        currentFile.value = ''
      }
    }
  }
  function cancel() {
    if (phase.value === '保存快照') return
    scanToken++
    reading?.abort()
    reading = null
    running?.cancel()
    running = null
    busy.value = false
    phase.value = ''
    currentFile.value = ''
    if (hasDisplay()) saveState.value = '本次已取消，当前显示上次结果'
    notice.value = '已取消，本次任务没有保存成功快照。'
  }

  onBeforeUnmount(() => {
    scanToken++
    reading?.abort()
    running?.cancel()
  })
  return {
    mode,
    selectedFiles,
    text,
    language,
    encoding,
    exclusions,
    current,
    saveState,
    busy,
    progress,
    phase,
    currentFile,
    processed,
    fileTotal,
    canScan,
    addFiles,
    clearText,
    demo,
    scan,
    cancel,
  }
}
export type ScanState = UnwrapNestedRefs<ReturnType<typeof useScan>>
