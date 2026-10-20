import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { analyzeText, summarize, type Snapshot, type Source, type FileStat } from '@/core'
import { deleteSnapshot, downloadFile, listSnapshots, saveSnapshot } from '@/platform/storage'
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
  postMessage(input: TestWorker['input']) {
    this.input = input
    if (TestWorker.outcome === 'pending') return
    queueMicrotask(() => {
      if (TestWorker.outcome === 'error') {
        this.onerror?.({ message: 'worker unavailable', filename: '/scan.worker.ts', lineno: 1 })
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
  await navigate('统计口径')
  expect(wrapper.get('.workspace-page').isVisible()).toBe(false)
  expect(wrapper.get('.rules-section').text()).toContain('三引号字符串')
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
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
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
  expect(wrapper.get('.workspace-page').isVisible()).toBe(true)
  expect(wrapper.get('.snapshot-caption').text()).toContain('历史快照')
  await navigate('扫描历史')
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
  expect(report.schemaVersion).toBe(1)
  expect(report.snapshot.totals.code).toBe(1)
  expect(repository.snapshots).toHaveLength(0)
})

it('does not save a cancelled scan or accept a late worker reply after navigation', async () => {
  TestWorker.outcome = 'pending'
  await open()
  await enterText()
  await scan()
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
