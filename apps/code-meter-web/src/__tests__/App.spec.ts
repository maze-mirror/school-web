import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import {
  analyzeText,
  summarize,
  localDateKey,
  type Snapshot,
  type Source,
  type FileStat,
} from '@/core'
import {
  deleteSnapshot,
  downloadFile,
  listSnapshots,
  saveSnapshot,
  snapshotXlsx,
  snapshotCsv,
  snapshotJson,
} from '@/platform/storage'
import App from '@/App.vue'

const repository = vi.hoisted(() => ({ snapshots: [] as Snapshot[] }))
vi.mock('@/platform/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/platform/storage')>()),
  listSnapshots: vi.fn(async () => [...repository.snapshots]),
  saveSnapshot: vi.fn(async (snapshot: Snapshot) => {
    repository.snapshots.unshift(snapshot)
  }),
  deleteSnapshot: vi.fn(async (id: string) => {
    repository.snapshots = repository.snapshots.filter((s) => s.id !== id)
  }),
  downloadFile: vi.fn(),
  snapshotXlsx: vi.fn(async () => new Uint8Array([80, 75]).buffer),
}))

// Exercise the real scan scheduler and page wiring; only the worker boundary and storage are replaced.
class TestWorker {
  static last: TestWorker
  static outcome: 'success' | 'error' | 'pending' = 'success'
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: ((event: { message: string; filename: string; lineno: number }) => void) | null = null
  onmessageerror: (() => void) | null = null
  terminate = vi.fn()
  input!: { sources: Source[]; rejected: FileStat[]; configKey: string }
  constructor() {
    TestWorker.last = this
  }
  postMessage(input: TestWorker['input'] | { snapshot: Snapshot; kind: 'csv' | 'json' | 'xlsx' }) {
    // Real Worker transport rejects Vue proxies; exercise the clone boundary too.
    input = structuredClone(input)
    if ('kind' in input) {
      queueMicrotask(async () => {
        try {
          const content =
            input.kind === 'xlsx'
              ? await snapshotXlsx(input.snapshot)
              : input.kind === 'json'
                ? snapshotJson(input.snapshot)
                : snapshotCsv(input.snapshot)
          this.onmessage?.({ data: { type: 'result', content } })
        } catch (error) {
          this.onmessage?.({
            data: { type: 'error', message: (error as Error).message },
          })
        }
      })
      return
    }
    this.input = input
    if (TestWorker.outcome === 'pending') return
    queueMicrotask(() => {
      if (TestWorker.outcome === 'error') {
        this.onerror?.({
          message: 'worker unavailable',
          filename: '/scan.worker.ts',
          lineno: 1,
        })
      } else this.finish()
    })
  }
  finish() {
    const { sources, rejected, configKey } = this.input
    this.onmessage?.({
      data: {
        type: 'result',
        result: summarize([...rejected, ...sources.map(analyzeText)], configKey),
      },
    })
  }
}

let wrapper: VueWrapper
beforeEach(() => {
  localStorage.clear()
  repository.snapshots = []
  vi.clearAllMocks()
  TestWorker.outcome = 'success'
  vi.stubGlobal('Worker', TestWorker)
})
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})
async function open() {
  wrapper = mount(App, { attachTo: document.body })
  await flushPromises()
}
async function navigate(label: string) {
  await wrapper
    .get('nav')
    .findAll('button')
    .find((b) => b.text() === label)!
    .trigger('click')
}
async function select(label: string, option: string) {
  await wrapper.get('[role="combobox"][aria-label="' + label + '"]').trigger('click')
  await wrapper
    .findAll('[role="option"]')
    .find((o) => o.text().includes(option))!
    .trigger('click')
}
async function enterText(text = 'print(1)\n# comment\n') {
  await wrapper.get('.segmented').findAll('button')[1]!.trigger('click')
  await wrapper.get('textarea').setValue(text)
}
async function scan() {
  await wrapper.get('.scan-button').trigger('click')
  await flushPromises()
}
function oldSnapshot(): Snapshot {
  return {
    ...summarize([analyzeText({ path: 'old.py', text: 'print(1)\nprint(2)' })]),
    id: 'old',
    projectId: 'restored',
    projectName: '恢复项目',
    scannedAt: new Date().toISOString(),
    timezone: 'Asia/Shanghai',
  }
}

it('preserves input and filters across pages; clearing text preserves results and history', async () => {
  await open()
  await enterText()
  await scan()
  await wrapper.get('#file-search').setValue('snippet')
  await navigate('项目介绍')
  expect(wrapper.get('.workspace-page').isVisible()).toBe(false)
  expect(wrapper.get('.introduction-article h2').text()).toBe('功能介绍')
  await navigate('工作台')
  expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toContain('print(1)')
  expect((wrapper.get('#file-search').element as HTMLInputElement).value).toBe('snippet')
  await wrapper.get('.text-actions').findAll('button')[1]!.trigger('click')
  expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('')
  expect(document.activeElement).toBe(wrapper.get('textarea').element)
  expect(wrapper.get('.main-count strong').text()).toBe('1')
  await navigate('扫描历史')
  expect(wrapper.findAll('.history-row')).toHaveLength(1)
})

it('reads uploaded files, retains the selection through navigation and counts repeated scans as snapshots', async () => {
  await open()
  const bytes = new TextEncoder().encode('print(1)\n# comment\n')
  const file = {
    name: 'real.py',
    webkitRelativePath: '',
    size: bytes.length,
    arrayBuffer: async () => bytes.slice().buffer,
  } as File
  const input = wrapper.get('input[type="file"]')
  Object.defineProperty(input.element, 'files', {
    value: [file],
    configurable: true,
  })
  await input.trigger('change')
  await navigate('扫描历史')
  await navigate('工作台')
  expect(wrapper.get('.selected-files').text()).toContain('real.py')
  await scan()
  await scan()
  expect(wrapper.get('.main-count strong').text()).toBe('1')
  expect(wrapper.get('.activity-head').text()).toContain('2 次成功扫描')
  expect(repository.snapshots).toHaveLength(2)
  expect(repository.snapshots[0]?.files[0]?.path).toBe('real.py')
  expect(JSON.stringify(repository.snapshots)).not.toContain('print(1)')
  await navigate('扫描历史')
  expect(wrapper.findAll('.history-row')).toHaveLength(2)
})

it('restores a project from old snapshots, views it and removes its result and activity together', async () => {
  repository.snapshots = [oldSnapshot()]
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  await open()
  expect(wrapper.get('[aria-label="项目"]').text()).toBe('恢复项目')
  expect(wrapper.get('.main-count strong').text()).toBe('2')
  await navigate('扫描历史')
  await wrapper.get('.history-actions .secondary-button').trigger('click')
  expect(wrapper.get('.workspace-page').isVisible()).toBe(false)
  expect(wrapper.get('.snapshot-page .main-count strong').text()).toBe('2')
  expect(wrapper.get('.snapshot-metadata').text()).toContain('已保存快照')
  await wrapper.get('.snapshot-page .section-heading button').trigger('click')
  await wrapper.get('.history-actions .text-button').trigger('click')
  await flushPromises()
  expect(deleteSnapshot).toHaveBeenCalledWith('old')
  expect(wrapper.findAll('.history-row')).toHaveLength(0)
  await navigate('工作台')
  expect(wrapper.get('.main-count strong').text()).toBe('—')
  expect(wrapper.get('.activity-head').text()).toContain('0 次成功扫描')
})

it('keeps the previous result visibly marked after a worker failure', async () => {
  await open()
  await enterText()
  await scan()
  TestWorker.outcome = 'error'
  await scan()
  expect(wrapper.get('.notice').text()).toContain('worker unavailable')
  expect(wrapper.get('.snapshot-caption').text()).toContain('本次统计失败，当前显示上次结果')
  expect(wrapper.get('.main-count strong').text()).toBe('1')
  expect(repository.snapshots).toHaveLength(1)
})

it('leaves a completed result exportable when history cannot be saved', async () => {
  vi.mocked(saveSnapshot).mockRejectedValueOnce(new Error('quota exceeded'))
  await open()
  await enterText()
  await scan()
  expect(wrapper.get('.notice').text()).toContain('统计已完成，但历史未保存')
  expect(wrapper.get('.main-count strong').text()).toBe('1')
  await wrapper.get('.export-actions').findAll('button')[1]!.trigger('click')
  const report = JSON.parse(String(vi.mocked(downloadFile).mock.calls[0]?.[1]))
  expect(report.schemaVersion).toBe(2)
  expect(report.snapshot.totals.code).toBe(1)
  expect(repository.snapshots).toHaveLength(0)
})

it('does not save a cancelled scan or accept a late worker reply after navigation', async () => {
  TestWorker.outcome = 'pending'
  await open()
  await enterText()
  await scan()
  expect(wrapper.get('.scan-detail').text()).toContain('分析代码')
  expect(wrapper.get('.scan-detail').text()).toContain('snippet.py')
  TestWorker.last.onmessage!({
    data: { type: 'progress', done: 1, total: 1, path: 'snippet.py' },
  })
  await flushPromises()
  expect(wrapper.get('.scan-detail').text()).toContain('已完成 1 / 1 个文件')
  await navigate('扫描历史')
  await navigate('工作台')
  await wrapper.get('.scan-actions .secondary-button').trigger('click')
  TestWorker.last.finish()
  await flushPromises()
  expect(TestWorker.last.terminate).toHaveBeenCalledOnce()
  expect(saveSnapshot).not.toHaveBeenCalled()
  expect(wrapper.get('.notice').text()).toContain('已取消')
  expect(wrapper.get('.main-count strong').text()).toBe('—')
})

it('keeps project histories separate and updates custom dates through the extracted toolbar', async () => {
  await open()
  await enterText()
  await scan()
  await wrapper.get('#file-search').setValue('old filter')
  await wrapper.get('#project-name').setValue('第二个项目')
  await wrapper.get('.project-create').trigger('submit')
  expect(wrapper.get('.main-count strong').text()).toBe('—')
  expect((wrapper.get('#file-search').element as HTMLInputElement).value).toBe('')
  await scan()
  expect(repository.snapshots[0]?.projectName).toBe('第二个项目')
  await navigate('扫描历史')
  expect(wrapper.findAll('.history-row')).toHaveLength(1)
  await select('项目', '我的项目')
  expect(wrapper.get('.history-section h2').text()).toContain('我的项目')
  expect(wrapper.findAll('.history-row')).toHaveLength(1)
  await select('时间', '自选日期')
  const dates = wrapper.findAll('input[type="date"]')
  await dates[0]!.setValue('2020-01-01')
  await dates[1]!.setValue('2020-01-02')
  expect(wrapper.findAll('.history-row')).toHaveLength(0)
  await navigate('工作台')
  expect(wrapper.get('.main-count strong').text()).toBe('—')
})

it('offers only mono and dark themes, persists dark and normalizes an obsolete theme', async () => {
  localStorage.setItem('code-meter-theme', 'blue')
  await open()
  expect(localStorage.getItem('code-meter-theme')).toBe('mono')
  await wrapper.get('[aria-label="主题配色"]').trigger('click')
  expect(wrapper.findAll('[role="option"]').map((o) => o.text().replace('✓', ''))).toEqual([
    '原色',
    '暗色',
  ])
  await wrapper.findAll('[role="option"]')[1]!.trigger('click')
  expect(wrapper.get('.meter-app').attributes('data-theme')).toBe('dark')
  expect(localStorage.getItem('code-meter-theme')).toBe('dark')
  wrapper.unmount()
  await open()
  expect(wrapper.get('.meter-app').attributes('data-theme')).toBe('dark')
})

it('releases an active worker and history clock when the application unmounts', async () => {
  TestWorker.outcome = 'pending'
  const clearClock = vi.spyOn(globalThis, 'clearInterval')
  const removeListener = vi.spyOn(window, 'removeEventListener')
  await open()
  await enterText()
  await scan()
  wrapper.unmount()
  TestWorker.last.finish()
  await flushPromises()
  expect(TestWorker.last.terminate).toHaveBeenCalledOnce()
  expect(saveSnapshot).not.toHaveBeenCalled()
  expect(clearClock).toHaveBeenCalled()
  expect(removeListener).toHaveBeenCalledWith('focus', expect.any(Function))
})

it('can still scan if loading history fails', async () => {
  vi.mocked(listSnapshots).mockRejectedValueOnce(new Error('storage unavailable'))
  await open()
  expect(wrapper.get('.notice').text()).toContain('历史无法读取')
  await enterText()
  await scan()
  expect(wrapper.get('.main-count strong').text()).toBe('1')
  expect(saveSnapshot).toHaveBeenCalledOnce()
})

it('shows creation only in the workspace and hides all project filters in the introduction', async () => {
  await open()
  expect(wrapper.get('.project-create button').text()).toContain('新建档案')
  await wrapper.get('#project-name').setValue('尚未建立的档案')
  await select('时间', '自选日期')
  const dates = wrapper.findAll('input[type="date"]')
  await dates[0]!.setValue('2026-10-21')
  await dates[1]!.setValue('2026-10-20')
  expect(wrapper.find('[role="alert"]').exists()).toBe(true)
  await navigate('扫描历史')
  expect(wrapper.find('.project-toolbar').exists()).toBe(true)
  expect(wrapper.find('.project-create').exists()).toBe(false)
  expect(wrapper.find('[aria-label="项目"]').exists()).toBe(true)
  expect(wrapper.find('[aria-label="时间"]').exists()).toBe(true)
  await navigate('项目介绍')
  expect(wrapper.find('.project-toolbar').exists()).toBe(false)
  expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  expect(wrapper.findAll('.introduction-sidebar a').map((link) => link.text())).toEqual([
    '功能介绍',
    '项目特点',
    '设计思路',
    '技术选型',
  ])
  expect(wrapper.find('.introduction-sidebar [aria-expanded]').exists()).toBe(false)
  await navigate('工作台')
  expect((wrapper.get('#project-name').element as HTMLInputElement).value).toBe('尚未建立的档案')
  expect(wrapper.find('[role="alert"]').exists()).toBe(true)
})

it('keeps English section headings and the physical-line equation in the workspace', async () => {
  await open()
  expect(wrapper.findAll('.workspace-page h2').map((heading) => heading.text())).toEqual([
    '01 / INPUT',
    '02 / OVERVIEW',
    '03 / COMPOSITION',
    '04 / ACTIVITY',
    '05 / CURRENT FILES',
  ])
  expect(wrapper.get('.overview-note').text()).toBe('总物理行 = 空行 + 纯注释行 + 有效代码行。')
  expect(wrapper.get('nav').text()).not.toContain('统计口径')
  expect(wrapper.find('.change-note').exists()).toBe(false)
  expect(wrapper.get('.workspace-page').text()).not.toContain('区间净变化')
  expect(wrapper.get('footer').text()).toContain('本地处理 · 无账号')
  expect(wrapper.get('footer').text()).not.toContain('physical-lines-')
})

it('shows the new language summary and exports Excel from the displayed snapshot', async () => {
  await open()
  await enterText('def f():\n    return 1\n')
  await scan()
  const table = wrapper.get('table[aria-label="按语言汇总统计"]')
  expect(table.findAll('thead th').map((cell) => cell.text())).toEqual([
    '语言',
    '源文件数',
    '代码行数',
    '空行数',
    '注释行数',
    '最大值',
    '最小值',
    '均值',
    '中位数',
  ])
  expect(table.findAll('tbody tr')[0]!.text()).toContain('Python')
  expect(
    table
      .findAll('tbody tr')[0]!
      .findAll('td')
      .map((cell) => cell.text()),
  ).toEqual(['1', '2', '0', '0', '2', '2', '2', '2'])
  await wrapper.get('.export-actions').findAll('button')[2]!.trigger('click')
  await flushPromises()
  expect(snapshotXlsx).toHaveBeenCalledOnce()
  expect(vi.mocked(downloadFile).mock.calls.at(-1)?.[0]).toMatch(/\.xlsx$/)
})

it('reports Excel generation failure and leaves the other export actions usable', async () => {
  vi.mocked(snapshotXlsx).mockRejectedValueOnce(new Error('workbook unavailable'))
  await open()
  await enterText()
  await scan()
  await wrapper.get('.export-actions').findAll('button')[2]!.trigger('click')
  await flushPromises()
  expect(wrapper.get('.files-section [role="alert"]').text()).toContain('workbook unavailable')
  expect(downloadFile).not.toHaveBeenCalled()
  await wrapper.get('.export-actions').findAll('button')[0]!.trigger('click')
  await flushPromises()
  expect(vi.mocked(downloadFile).mock.calls[0]?.[0]).toMatch(/\.csv$/)
})

it('links a selected day to cumulative composition and opens its explanation from the calendar', async () => {
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const emptyDay = new Date(yesterday)
  emptyDay.setDate(emptyDay.getDate() - 1)
  const python = {
    ...oldSnapshot(),
    id: 'python',
    scannedAt: yesterday.toISOString(),
  }
  const cpp = {
    ...python,
    id: 'cpp',
    ...summarize([analyzeText({ path: 'main.cpp', text: 'int main() { return 0; }' })]),
  }
  repository.snapshots = [
    oldSnapshot(),
    python,
    { ...python, id: 'repeat' },
    cpp,
    { ...python, id: 'other-project', projectId: 'other' },
  ]
  await open()
  expect(wrapper.get('.pie-center strong').text()).toBe('2')
  const date = localDateKey(yesterday)
  await wrapper.get(`[data-date="${date}"]`).trigger('mouseenter')
  expect(wrapper.get('.composition-context').text()).toContain(date + ' · 当天累计 · 3 次扫描')
  expect(wrapper.get('.pie-center strong').text()).toBe('5')
  expect(wrapper.get('.language-list').text()).toContain('Python2 文件次')
  expect(wrapper.get('.language-list').text()).toContain('80.0%')
  expect(wrapper.get('.language-list').text()).toContain('C++1 文件次')
  expect(wrapper.get('.main-count strong').text()).toBe('2')
  await wrapper.get(`[data-date="${localDateKey(emptyDay)}"]`).trigger('click')
  expect(wrapper.get('.pie-center strong').text()).toBe('0')
  expect(wrapper.get('.language-layout').text()).toContain('当天没有已保存的扫描')
  await wrapper.get('.composition-context button').trigger('click')
  expect(wrapper.get('.pie-center strong').text()).toBe('2')
  await wrapper.get(`[data-date="${date}"]`).trigger('focus')
  await select('时间', '一年')
  expect(wrapper.get('.composition-context').text()).toBe('当前快照')
  await wrapper.get('.heat-footer a').trigger('click')
  await flushPromises()
  expect(wrapper.get('.introduction-article h2').text()).toBe('功能介绍')
  expect(document.activeElement).toBe(wrapper.get('#activity-method').element)
  expect(wrapper.get('.introduction-article').text()).toContain('重复扫描同一份代码也累计')
  expect(wrapper.get('.introduction-article').text()).toContain('220 行')
  expect(wrapper.get('a[href="#features"]').attributes('aria-current')).toBe('page')
  expect(wrapper.find('.project-toolbar').exists()).toBe(false)
  await wrapper.get('a[href="#characteristics"]').trigger('click')
  expect(wrapper.get('.introduction-article').text()).toContain('IndexedDB')
  expect(wrapper.get('.introduction-article').text()).toContain('更换网址端口不会自动同步')
  await wrapper.get('a[href="#technology"]').trigger('click')
  expect(wrapper.get('.introduction-article').text()).toContain('Vue 3')
  expect(wrapper.get('.introduction-article').text()).toContain('Web Worker')
  await wrapper.get('a[href="#features"]').trigger('click')
  expect(wrapper.get('.introduction-article').text()).toContain('UTF-8 优先，失败按 GBK')
  expect(wrapper.get('.introduction-article').text()).toContain('不修改原文件')
  await wrapper.get('a[href="#design"]').trigger('click')
  expect(wrapper.get('.introduction-article').text()).toContain('三引号字符串')
  expect(document.activeElement).toBe(wrapper.get('#design').element)
})

it('scans all three new text languages, retains history and exports unknown function counts', async () => {
  await open()
  for (const [name, language, extension, text, code] of [
    ['Java', 'java', 'java', '/** note */\nint n = 1;', 1],
    ['JavaScript', 'javascript', 'js', 'const s = `hello ${\n // name\n userName\n}`;', 3],
    ['TypeScript', 'typescript', 'ts', 'interface User {\n name: string; // field\n}', 3],
  ] as const) {
    await enterText(text)
    await select('代码语言', name)
    await scan()
    const latest = repository.snapshots[0]!
    expect(latest.files[0]?.language).toBe(language)
    expect(latest.files[0]?.path).toBe('snippet.' + extension)
    expect(latest.files[0]?.functionCount).toBeNull()
    expect(wrapper.get('.main-count strong').text()).toBe(String(code))
    expect(wrapper.get('.language-list').text()).toContain(name)
    expect(wrapper.get('.report-summary tbody tr').findAll('td')).toHaveLength(8)
  }
  // Exports are also derived from the real result, not a language-specific UI branch.
  const jsonButton = wrapper.findAll('button').find((button) => button.text() === '导出 JSON ↗')!
  await jsonButton.trigger('click')
  await flushPromises()
  const exported = JSON.parse(String(vi.mocked(downloadFile).mock.calls.at(-1)?.[1]))
  expect(exported.snapshot.files[0].language).toBe('typescript')
  expect(exported.snapshot.files[0].functionCount).toBeNull()
  await navigate('扫描历史')
  expect(wrapper.findAll('.history-row')).toHaveLength(3)
})

it('hides function fields but displays located parser warnings and preserves exported data', async () => {
  const files = [
    analyzeText({ path: 'function-only.py', text: 'def broken(:\n    pass' }),
    analyzeText({ path: 'line-warning.py', text: 'print("unfinished' }),
    analyzeText({ path: 'line-warning.ts', text: 'flags[line]! |= kind;' }),
    analyzeText({ path: 'valid.py', text: 'def ok():\n    return 1' }),
  ]
  const snapshot = { ...oldSnapshot(), ...summarize(files), id: 'visibility' }
  repository.snapshots = [snapshot]
  await open()
  expect(files[0]!.warnings.join('')).toContain('函数个数暂不可用')
  expect(files[3]!.functionCount).toBe(1)
  expect(wrapper.get('.workspace-page').text()).not.toContain('函数')
  expect(wrapper.get('.report-summary thead').findAll('th')).toHaveLength(9)
  expect(wrapper.get('.files-section > .table-scroll thead').findAll('th')).toHaveLength(7)
  expect(wrapper.get('.table-controls').text()).toContain('仅看异常 / 跳过（2）')
  expect(wrapper.get('.files-section').text()).toContain('字符串可能未闭合')
  expect(files[2]!.warnings.join('')).toContain('当前解析器未完整识别此处语法')
  expect(wrapper.get('.files-section').text()).toContain('第 1 行第')
  expect(wrapper.get('.files-section').text()).toContain('不能据此判定源码错误')
  await wrapper.get('.table-controls input[type="checkbox"]').setValue(true)
  const rows = wrapper.findAll('.files-section > .table-scroll tbody tr')
  expect(rows).toHaveLength(2)
  expect(rows[0]!.get('.file-path').text()).toBe('line-warning.py')
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '导出 JSON ↗')!
    .trigger('click')
  await flushPromises()
  const exported = JSON.parse(String(vi.mocked(downloadFile).mock.calls.at(-1)?.[1]))
  expect(exported.snapshot.files[0].warnings).toEqual(files[0]!.warnings)
  expect(exported.snapshot.files[2].warnings).toEqual(files[2]!.warnings)
  expect(exported.snapshot.files[3].functionCount).toBe(1)
  expect(snapshot.files[0]!.warnings).toEqual(files[0]!.warnings)
  await navigate('项目介绍')
  expect(wrapper.get('.introduction-article').text()).not.toContain('函数')
  await wrapper.get('a[href="#design"]').trigger('click')
  expect(wrapper.get('.introduction-article h2').text()).toBe('设计思路')
  expect(wrapper.get('.introduction-article').text()).not.toContain('函数')
})

it('previews supported candidates, selects GBK, filters stubs and restores their history', async () => {
  await open()
  const makeFile = (name: string, bytes: Uint8Array) =>
    ({
      name,
      webkitRelativePath: '',
      size: bytes.length,
      arrayBuffer: async () => bytes.slice().buffer,
    }) as File
  const input = wrapper.get('input[type="file"]')
  Object.defineProperty(input.element, 'files', {
    configurable: true,
    value: [
      makeFile('a.py', new TextEncoder().encode('x = 1')),
      makeFile('types.pyi', new TextEncoder().encode('# types\nx: int\ny: str')),
      makeFile('legacy.c', new Uint8Array([47, 47, 32, 0xd6, 0xd0, 0xce, 0xc4, 10])),
      makeFile('native.so', new Uint8Array([0xff, 0])),
    ],
  })
  await input.trigger('change')
  expect(wrapper.get('.selected-head').text()).toContain('候选源文件 3 个')
  await scan()
  expect(repository.snapshots[0]!.files.find((file) => file.path === 'legacy.c')?.status).toBe(
    'error',
  )
  await wrapper.get('.input-settings summary').trigger('click')
  await select('文件编码', 'UTF-8 优先，失败按 GBK')
  await scan()
  const latest = repository.snapshots[0]!
  expect(JSON.parse(latest.configKey).encoding).toBe('utf-8-gbk')
  expect(latest.files.find((file) => file.path === 'legacy.c')?.status).toBe('ok')
  expect(latest.files.find((file) => file.path === 'native.so')?.status).toBe('skipped')
  expect(wrapper.get('.main-count strong').text()).toBe('3')
  expect(wrapper.get('.language-list').text()).toContain('Python 类型声明')
  await select('文件语言筛选', 'Python 类型声明')
  expect(wrapper.findAll('.files-section > .table-scroll tbody tr')).toHaveLength(1)
  expect(wrapper.get('.files-section > .table-scroll tbody').text()).toContain('types.pyi')
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '导出 JSON ↗')!
    .trigger('click')
  await flushPromises()
  const exported = JSON.parse(String(vi.mocked(downloadFile).mock.calls.at(-1)?.[1]))
  expect(exported.summary.total.sourceFiles).toBe(3)
  wrapper.unmount()
  await open()
  expect(wrapper.get('.main-count strong').text()).toBe('3')
  expect(wrapper.get('.language-list').text()).toContain('Python 类型声明')
})

it('cancels during reading, restarts safely and ignores late data from the cancelled file', async () => {
  repository.snapshots = [oldSnapshot()]
  await open()
  let finish!: (value: ArrayBuffer) => void
  const next = vi.fn(async () => new ArrayBuffer(0))
  const input = wrapper.get('input[type="file"]')
  const files = [
    {
      name: 'pending.pyi',
      size: 1,
      webkitRelativePath: '',
      arrayBuffer: () =>
        new Promise<ArrayBuffer>((resolve) => {
          finish = resolve
        }),
    },
    { name: 'next.pyi', size: 0, webkitRelativePath: '', arrayBuffer: next },
  ]
  Object.defineProperty(input.element, 'files', {
    configurable: true,
    value: files,
  })
  await input.trigger('change')
  await scan()
  expect(wrapper.get('.scan-detail').text()).toContain('读取输入 · 已完成 0 / 2 个文件')
  expect(wrapper.get('.scan-file').text()).toBe('pending.pyi')
  await wrapper.get('.scan-actions .secondary-button').trigger('click')
  expect(wrapper.get('.snapshot-caption').text()).toContain('本次已取消，当前显示上次结果')
  await wrapper.get('.selected-head button').trigger('click')
  const bytes = new TextEncoder().encode('x: int')
  Object.defineProperty(input.element, 'files', {
    configurable: true,
    value: [
      {
        name: 'fresh.pyi',
        size: bytes.length,
        webkitRelativePath: '',
        arrayBuffer: async () => bytes.buffer,
      },
    ],
  })
  await input.trigger('change')
  await scan()
  finish(new ArrayBuffer(0))
  await flushPromises()
  expect(next).not.toHaveBeenCalled()
  expect(repository.snapshots).toHaveLength(2)
  expect(repository.snapshots[0]!.files[0]?.path).toBe('fresh.pyi')
  expect(wrapper.get('.main-count strong').text()).toBe('1')
  expect(wrapper.find('.scan-detail').exists()).toBe(false)
  expect(wrapper.get('.notice').text()).toContain('成功 1，失败 0，跳过 0')
})

it('paginates and filters 5000 files while an Excel export is pending', async () => {
  const example = analyzeText({ path: 'a.pyi', text: 'x: int' })
  repository.snapshots = [
    {
      ...oldSnapshot(),
      ...summarize(
        Array.from({ length: 5000 }, (_, i) => ({
          ...example,
          path: `types/${String(i).padStart(4, '0')}.pyi`,
        })),
      ),
    },
  ]
  await open()
  const rows = () => wrapper.findAll('.files-section > .table-scroll tbody tr')
  expect(rows()).toHaveLength(50)
  await wrapper.get('.pagination-info button').trigger('click')
  expect(rows()).toHaveLength(100)
  let finish!: (bytes: ArrayBuffer) => void
  vi.mocked(snapshotXlsx).mockImplementationOnce(
    () =>
      new Promise<ArrayBuffer>((resolve) => {
        finish = resolve
      }),
  )
  await wrapper.get('.export-actions').findAll('button')[2]!.trigger('click')
  await flushPromises()
  expect(wrapper.get('.export-status').text()).toContain('正在生成 Excel')
  await wrapper.get('#file-search').setValue('4999')
  expect(rows()).toHaveLength(1)
  expect(rows()[0]!.text()).toContain('types/4999.pyi')
  finish(new Uint8Array([80, 75]).buffer)
  await flushPromises()
  expect(wrapper.get('.export-status').text()).toContain('Excel 已生成并发起下载')
  expect(snapshotXlsx).toHaveBeenCalledWith(repository.snapshots[0])
  expect(downloadFile).toHaveBeenCalledOnce()
})

it('opens a fixed historical result without the workspace chrome or changing the current input', async () => {
  const archived: Snapshot = {
    ...oldSnapshot(),
    ...summarize([
      analyzeText({ path: 'archived.py', text: 'x = 1\ny = 2' }),
      analyzeText({ path: 'archived.c', text: 'int x;' }),
    ]),
  }
  repository.snapshots = [archived]
  await open()
  const bytes = new TextEncoder().encode('print(1)')
  const input = wrapper.get('input[type="file"]')
  Object.defineProperty(input.element, 'files', {
    configurable: true,
    value: [
      {
        name: 'latest.py',
        webkitRelativePath: '',
        size: bytes.length,
        arrayBuffer: async () => bytes.buffer,
      },
    ],
  })
  await input.trigger('change')
  await scan()
  expect(wrapper.get('.workspace-page .main-count strong').text()).toBe('1')
  await wrapper.get(`[data-date="${localDateKey(new Date())}"]`).trigger('click')
  expect(wrapper.get('.workspace-page .pie-center strong').text()).toBe('4')
  await navigate('扫描历史')
  const row = wrapper.findAll('.history-row').find((item) => item.text().includes('3 行'))!
  await row.get('.secondary-button').trigger('click')
  const result = wrapper.get('.snapshot-page')
  expect(result.findAll('h1,h2').map((heading) => heading.text())).toEqual([
    '01 / OVERVIEW',
    '02 / FILES',
  ])
  expect(result.get('.main-count strong').text()).toBe('3')
  expect(result.get('.pie-center strong').text()).toBe('3')
  expect(result.get('.files-section').text()).toContain('archived.py')
  expect(result.text()).not.toContain('latest.py')
  expect(
    result
      .find('textarea,input[type="file"],.input-panel,.activity-grid,.composition-context')
      .exists(),
  ).toBe(false)
  expect(wrapper.find('.site-header,.intro,.project-toolbar,.top-strip,footer').exists()).toBe(
    false,
  )
  expect(wrapper.get('.workspace-page').isVisible()).toBe(false)
  await result.get('.export-actions').findAll('button')[1]!.trigger('click')
  await flushPromises()
  const exported = JSON.parse(String(vi.mocked(downloadFile).mock.calls.at(-1)?.[1]))
  expect(exported.snapshot.id).toBe(archived.id)
  expect(exported.summary.total.codeLines).toBe(3)
  await result.get('.section-heading button').trigger('click')
  expect(wrapper.findAll('.history-row')).toHaveLength(2)
  await navigate('工作台')
  expect(wrapper.get('.selected-files').text()).toContain('latest.py')
  expect(wrapper.get('.workspace-page .main-count strong').text()).toBe('1')
  expect(wrapper.get('.workspace-page .pie-center strong').text()).toBe('4')
  expect(repository.snapshots).toHaveLength(2)
})

it('keeps the historical snapshot fixed when a background scan completes', async () => {
  repository.snapshots = [oldSnapshot()]
  TestWorker.outcome = 'pending'
  await open()
  await enterText('print(1)')
  await scan()
  const pending = TestWorker.last
  await navigate('扫描历史')
  await wrapper.get('.history-actions .secondary-button').trigger('click')
  pending.finish()
  await flushPromises()
  expect(wrapper.get('.snapshot-page .main-count strong').text()).toBe('2')
  expect(wrapper.get('.snapshot-page .pie-center strong').text()).toBe('2')
  expect(wrapper.get('.workspace-page').isVisible()).toBe(false)
  expect(repository.snapshots).toHaveLength(2)
  await wrapper.get('.snapshot-page .section-heading button').trigger('click')
  await navigate('工作台')
  expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('print(1)')
  expect(wrapper.get('.workspace-page .main-count strong').text()).toBe('1')
})

it('expands historical files in batches of 50 and searches all filenames without altering totals', async () => {
  const example = analyzeText({ path: 'a.pyi', text: 'x: int' })
  const archived = {
    ...oldSnapshot(),
    ...summarize(
      Array.from({ length: 125 }, (_, i) => ({
        ...example,
        path: i === 110 ? 'types/needle.PYI' : `types/${i}.pyi`,
      })),
    ),
  }
  repository.snapshots = [archived]
  await open()
  await navigate('扫描历史')
  await wrapper.get('.history-actions .secondary-button').trigger('click')
  const result = wrapper.get('.snapshot-page')
  const rows = () => result.findAll('.files-section > .table-scroll tbody tr')
  expect(rows()).toHaveLength(50)
  expect(result.get('.pagination-info button').text()).toBe('继续展开')
  await result.get('.pagination-info button').trigger('click')
  expect(rows()).toHaveLength(100)
  await result.get('.pagination-info button').trigger('click')
  expect(rows()).toHaveLength(125)
  expect(result.find('.pagination-info button').exists()).toBe(false)
  await result.get('#snapshot-file-search').setValue('needle.pyi')
  expect(rows()).toHaveLength(1)
  expect(rows()[0]!.text()).toContain('needle.PYI')
  expect(result.get('.main-count strong').text()).toBe('125')
  expect(result.get('.pie-center strong').text()).toBe('125')
  await result.get('.export-actions').findAll('button')[1]!.trigger('click')
  await flushPromises()
  const report = JSON.parse(String(vi.mocked(downloadFile).mock.calls.at(-1)?.[1]))
  expect(report.summary.total.sourceFiles).toBe(125)
  expect(report.snapshot.files).toHaveLength(125)
  await result.get('.section-heading button').trigger('click')
  await wrapper.get('.history-actions .secondary-button').trigger('click')
  expect((wrapper.get('#snapshot-file-search').element as HTMLInputElement).value).toBe('')
  expect(wrapper.findAll('.snapshot-page .files-section > .table-scroll tbody tr')).toHaveLength(50)
})
