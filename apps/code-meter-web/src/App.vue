<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import {
  LANGUAGES,
  RULE_VERSION,
  emptyCounts,
  activityDays,
  periodSnapshots,
  localDateKey,
  type Snapshot,
  type Language,
} from '@/core'
import { readSources, filePath, DEFAULT_EXCLUSIONS, LIMITS } from '@/platform/files'
import { startScan } from '@/platform/scanner'
import {
  listSnapshots,
  saveSnapshot,
  deleteSnapshot,
  downloadFile,
  snapshotCsv,
} from '@/platform/storage'
import MeterSelect from '@/components/MeterSelect.vue'
import LanguagePie from '@/components/LanguagePie.vue'
import ActivityGrid from '@/components/ActivityGrid.vue'

type Project = { id: string; name: string }
const page = ref<'workspace' | 'history' | 'rules'>('workspace')
const mode = ref<'files' | 'text'>('files')
const projects = ref<Project[]>([]),
  projectId = ref(''),
  newProjectName = ref('')
const selectedFiles = ref<File[]>([]),
  text = ref(''),
  language = ref<Language>('python')
const exclusions = ref(DEFAULT_EXCLUSIONS.join(', '))
const snapshots = ref<Snapshot[]>([]),
  current = ref<Snapshot | null>(null)
const busy = ref(false),
  progress = ref(0),
  phase = ref(''),
  notice = ref(''),
  dragging = ref(false),
  storageReady = ref(false)
const period = ref('30'),
  startDate = ref(''),
  endDate = ref('')
const search = ref(''),
  onlyIssues = ref(false),
  sort = ref<'code' | 'path'>('code')
const theme = ref('mono'),
  saveState = ref('')
const today = ref(localDateKey(new Date()))
let clock: ReturnType<typeof setInterval> | undefined
function refreshToday() {
  today.value = localDateKey(new Date())
}
const fileInput = ref<HTMLInputElement | null>(null),
  folderInput = ref<HTMLInputElement | null>(null)
let running: ReturnType<typeof startScan> | null = null,
  scanToken = 0
const project = computed(() => projects.value.find((p) => p.id === projectId.value))
const projectSnapshots = computed(() =>
  snapshots.value.filter((s) => s.projectId === projectId.value),
)
const range = computed(() => {
  const end = new Date(today.value + 'T00:00:00')
  end.setDate(end.getDate() + 1)
  const start = new Date(end)
  start.setDate(start.getDate() - Number(period.value === 'custom' ? 30 : period.value))
  if (period.value === 'custom') {
    const a = new Date(startDate.value + 'T00:00:00'),
      b = new Date(endDate.value + 'T00:00:00')
    b.setDate(b.getDate() + 1)
    if (!Number.isFinite(+a) || !Number.isFinite(+b) || a >= b) return null
    if ((+b - +a) / 86400000 > 366) return null
    return { start: a, end: b }
  }
  return { start, end }
})
const periodData = computed(() =>
  range.value
    ? periodSnapshots(snapshots.value, projectId.value, range.value.start, range.value.end)
    : null,
)
const display = computed(() =>
  current.value?.projectId === projectId.value ? current.value : (periodData.value?.last ?? null),
)
const counts = computed(() => display.value?.totals ?? emptyCounts())
const days = computed(() =>
  range.value ? activityDays(projectSnapshots.value, range.value.start, range.value.end) : [],
)
const history = computed(() => periodData.value?.within ?? [])
const rowLimit = ref(50)
const allFileRows = computed(() => {
  const rows = (display.value?.files ?? []).filter(
    (f) =>
      f.path.toLowerCase().includes(search.value.toLowerCase()) &&
      (!onlyIssues.value || f.status !== 'ok' || f.warnings.length),
  )
  return rows.sort((a, b) =>
    sort.value === 'code' ? b.counts.code - a.counts.code : a.path.localeCompare(b.path),
  )
})
const fileRows = computed(() => allFileRows.value.slice(0, rowLimit.value))
watch([search, onlyIssues, sort, display], () => {
  rowLimit.value = 50
})
const successful = computed(() => display.value?.files.filter((f) => f.status === 'ok').length ?? 0)
const issueCount = computed(
  () => display.value?.files.filter((f) => f.status !== 'ok' || f.warnings.length).length ?? 0,
)
const canScan = computed(
  () =>
    !!project.value &&
    !busy.value &&
    (mode.value === 'files' ? selectedFiles.value.length > 0 : text.value.length > 0),
)
function persistProjects() {
  try {
    localStorage.setItem('code-meter-projects', JSON.stringify(projects.value))
    return true
  } catch {
    notice.value = '项目设置未能保存；仍可以统计和导出。'
    return false
  }
}
function addProject() {
  const name = newProjectName.value.trim()
  if (!name) {
    notice.value = '请输入项目名称'
    return
  }
  const p = { id: crypto.randomUUID(), name }
  projects.value.push(p)
  projectId.value = p.id
  newProjectName.value = ''
  current.value = null
  const saved = persistProjects()
  notice.value = saved
    ? '已建立独立项目，历史按项目分别保存。'
    : '项目设置未能保存；完成扫描后会从历史快照恢复项目，请导出备份。'
}
function changeProject() {
  current.value = null
  search.value = ''
  saveState.value = ''
}
function changePeriod() {
  current.value = null
}
function chooseFiles(event: Event) {
  const input = event.target as HTMLInputElement
  addFiles(Array.from(input.files ?? []))
  input.value = ''
}
function addFiles(files: File[]) {
  if (busy.value) return
  selectedFiles.value.push(...files)
  notice.value = `已选择 ${selectedFiles.value.length} 个文件；重复路径将在统计时列出。`
}
function drop(event: DragEvent) {
  dragging.value = false
  addFiles(Array.from(event.dataTransfer?.files ?? []))
}
const textInput = ref<HTMLTextAreaElement | null>(null)
function clearText() {
  if (busy.value) return
  text.value = ''
  notice.value = ''
  textInput.value?.focus()
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
  notice.value = ''
  saveState.value = ''
  const p = project.value!
  try {
    const excluded = [
      ...new Set(
        exclusions.value
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    ].sort()
    if (mode.value === 'text' && new TextEncoder().encode(text.value).length > LIMITS.maxFileBytes)
      throw new Error('粘贴文本超过 5 MB')
    const input =
      mode.value === 'files'
        ? await readSources(selectedFiles.value, excluded)
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
    const configKey = JSON.stringify({
      rule: RULE_VERSION,
      exclusions: excluded,
      override: mode.value === 'text' ? language.value : null,
      pythonDocstrings: 'code',
    })
    running = startScan(input.sources, input.rejected, configKey, (done, total) => {
      progress.value = total ? Math.round((done / total) * 100) : 100
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
    page.value = 'workspace'
    progress.value = 100
    refreshToday()
    if (!result.files.some((f) => f.status === 'ok')) {
      saveState.value = '无成功文件，未计入活动'
      notice.value = '没有可统计的文件，请查看明细中的原因。'
      return
    }
    phase.value = '保存快照'
    try {
      await saveSnapshot(snapshot)
      snapshots.value = [snapshot, ...snapshots.value.filter((s) => s.id !== snapshot.id)]
      storageReady.value = true
      saveState.value = '已保存到此浏览器'
      notice.value = '统计完成。项目总量使用本次快照，不累加重复扫描。'
    } catch (e) {
      saveState.value = '保存失败，可导出备份'
      notice.value = `统计已完成，但历史未保存：${errorText(e)}`
    }
  } catch (e) {
    if (token === scanToken) {
      notice.value = errorText(e)
      if (display.value) saveState.value = '本次统计失败，当前显示上次结果'
    }
  } finally {
    if (token === scanToken) {
      busy.value = false
      running = null
      phase.value = ''
    }
  }
}
function cancel() {
  scanToken++
  running?.cancel()
  running = null
  busy.value = false
  notice.value = '已取消，本次任务没有保存成功快照。'
}
function errorText(e: unknown) {
  return e instanceof Error ? e.message : '操作失败，请检查浏览器存储与输入后重试。'
}
function formatTime(time: string) {
  return new Date(time).toLocaleString('zh-CN', { hour12: false })
}
function exportResult(kind: 'json' | 'csv') {
  const s = display.value
  if (!s) return
  const name = `code-meter-${localDateKey(new Date(s.scannedAt))}`
  downloadFile(
    `${name}.${kind}`,
    kind === 'json' ? JSON.stringify({ schemaVersion: 1, snapshot: s }, null, 2) : snapshotCsv(s),
    kind === 'json' ? 'application/json;charset=utf-8' : 'text/csv;charset=utf-8',
  )
}
function viewSnapshot(s: Snapshot) {
  current.value = s
  page.value = 'workspace'
  saveState.value = '历史快照'
}
async function removeSnapshot(s: Snapshot) {
  if (!window.confirm(`删除 ${formatTime(s.scannedAt)} 的快照？此操作会影响活动统计与比较基线。`))
    return
  try {
    await deleteSnapshot(s.id)
    snapshots.value = await listSnapshots()
    if (current.value?.id === s.id) current.value = null
    notice.value = '已删除快照。'
  } catch (e) {
    notice.value = errorText(e)
  }
}
function setTheme() {
  try {
    localStorage.setItem('code-meter-theme', theme.value)
  } catch {
    notice.value = '主题已切换，但设置未能保存。'
  }
}
onMounted(async () => {
  try {
    const raw = JSON.parse(localStorage.getItem('code-meter-projects') ?? '[]')
    if (Array.isArray(raw))
      projects.value = raw.filter(
        (p) => p && typeof p.id === 'string' && typeof p.name === 'string',
      )
    const saved = localStorage.getItem('code-meter-theme')
    if (saved === 'dark' || saved === 'mono') theme.value = saved
    else if (saved) {
      theme.value = 'mono'
      setTheme()
    }
  } catch {
    notice.value = '本地设置无法读取，已使用默认设置。'
  }
  const now = new Date()
  endDate.value = localDateKey(now)
  now.setDate(now.getDate() - 29)
  startDate.value = localDateKey(now)
  try {
    snapshots.value = await listSnapshots()
    storageReady.value = true
  } catch (e) {
    notice.value = `历史无法读取：${errorText(e)}；仍可进行统计。`
  }
  for (const s of snapshots.value) {
    if (!projects.value.some((p) => p.id === s.projectId))
      projects.value.push({ id: s.projectId, name: s.projectName })
  }
  if (!projects.value.length) projects.value = [{ id: crypto.randomUUID(), name: '我的项目' }]
  projectId.value = projects.value[0]!.id
  persistProjects()
  refreshToday()
  clock = setInterval(refreshToday, 60000)
  window.addEventListener('focus', refreshToday)
  document.addEventListener('visibilitychange', refreshToday)
})
onBeforeUnmount(() => {
  scanToken++
  running?.cancel()
  if (clock) clearInterval(clock)
  window.removeEventListener('focus', refreshToday)
  document.removeEventListener('visibilitychange', refreshToday)
})
</script>

<template>
  <div class="meter-app" :data-theme="theme">
    <div class="top-strip" aria-hidden="true">
      <div class="strip-track">
        <span v-for="n in 8" :key="n"
          >□ READ THE CODE　 ■ COUNT WHAT MATTERS　 □ ONE LINE AT A TIME　</span
        >
      </div>
    </div>
    <div class="page-shell">
      <header class="site-header">
        <a class="brand" href="#" @click.prevent="page = 'workspace'"
          ><span class="brand-mark">■</span> code / meter<span class="version">v0.1</span></a
        >
        <nav aria-label="页面导航">
          <button
            :aria-current="page === 'workspace' ? 'page' : undefined"
            @click="page = 'workspace'"
          >
            工作台</button
          ><button
            :aria-current="page === 'history' ? 'page' : undefined"
            @click="page = 'history'"
          >
            扫描历史</button
          ><button :aria-current="page === 'rules' ? 'page' : undefined" @click="page = 'rules'">
            统计口径
          </button>
        </nav>
        <div class="theme-select">
          <MeterSelect
            v-model="theme"
            label="主题配色"
            :options="[
              { value: 'mono', label: '原色' },
              { value: 'dark', label: '暗色' },
            ]"
            @change="setTheme"
          />
        </div>
      </header>
      <section class="intro">
        <div>
          <p class="eyebrow">A SMALL TOOL FOR YOUR SOURCE.</p>
          <h1>
            {{
              page === 'history'
                ? 'Every scan, a trace.'
                : page === 'rules'
                  ? 'Define before counting.'
                  : 'Code, without the noise.'
            }}
          </h1>
          <p class="intro-copy">
            {{
              page === 'history'
                ? '每一次扫描，留下可复查的记录。'
                : page === 'rules'
                  ? '知道怎样计算，才知道数字意味着什么。'
                  : '去掉空行与注释，看见代码本身。'
            }}
          </p>
        </div>
      </section>
      <section class="project-toolbar" aria-label="项目与时间筛选">
        <div class="toolbar-field">
          <span>项目</span
          ><MeterSelect
            v-model="projectId"
            label="项目"
            :disabled="busy"
            :options="projects.map((p) => ({ value: p.id, label: p.name }))"
            @change="changeProject"
          />
        </div>
        <form class="project-create" @submit.prevent="addProject">
          <label class="sr-only" for="project-name">新项目名称</label
          ><input
            id="project-name"
            v-model="newProjectName"
            placeholder="新项目名称"
            maxlength="60"
            :disabled="busy"
          /><button class="secondary-button" :disabled="busy || !newProjectName.trim()">
            ＋ 新建
          </button>
        </form>
        <div class="period-select toolbar-field">
          <span>时间</span
          ><MeterSelect
            v-model="period"
            label="时间"
            :options="[
              { value: '7', label: '一周 · 7 天' },
              { value: '30', label: '一月 · 30 天' },
              { value: '365', label: '一年 · 365 天' },
              { value: 'custom', label: '自选日期' },
            ]"
            @change="changePeriod"
          />
        </div>
        <template v-if="period === 'custom'"
          ><label>开始<input v-model="startDate" type="date" @change="changePeriod" /></label
          ><label>结束<input v-model="endDate" type="date" @change="changePeriod" /></label
        ></template>
      </section>
      <p v-if="!range" class="notice" role="alert">请选择有效日期范围；自定义范围最多 366 天。</p>
      <div v-if="notice" class="notice" role="status">
        <span class="notice-mark" aria-hidden="true">i</span>
        <p>{{ notice }}</p>
        <button type="button" class="notice-close" aria-label="关闭提示" @click="notice = ''">
          ×
        </button>
      </div>

      <template v-if="page === 'workspace'">
        <section class="workspace-grid">
          <div class="input-panel">
            <div class="section-heading">
              <div>
                <span class="section-index">01 / INPUT</span>
                <h2>从一份代码开始</h2>
              </div>
              <div class="segmented" aria-label="输入方式">
                <button :aria-pressed="mode === 'files'" :disabled="busy" @click="mode = 'files'">
                  文件</button
                ><button :aria-pressed="mode === 'text'" :disabled="busy" @click="mode = 'text'">
                  文本
                </button>
              </div>
            </div>
            <template v-if="mode === 'files'"
              ><div
                class="drop-zone"
                :class="{ dragging }"
                @dragover.prevent="dragging = true"
                @dragleave.prevent="dragging = false"
                @drop.prevent="drop"
              >
                <span class="drop-mark" aria-hidden="true">[ + ]</span
                ><strong>把源代码放在这里</strong>
                <p>拖入文件，或从本地选择。<br />C / C++ / Python</p>
                <div class="drop-actions">
                  <button class="primary-button" :disabled="busy" @click="fileInput?.click()">
                    选择文件 ↗</button
                  ><button class="secondary-button" :disabled="busy" @click="folderInput?.click()">
                    选择文件夹
                  </button>
                </div>
                <small>只在此浏览器处理，不上传代码。</small>
              </div>
              <input
                ref="fileInput"
                class="sr-only"
                type="file"
                multiple
                @change="chooseFiles"
              /><input
                ref="folderInput"
                class="sr-only"
                type="file"
                multiple
                webkitdirectory
                @change="chooseFiles"
              />
              <div v-if="selectedFiles.length" class="selected-files">
                <div class="selected-head">
                  <span
                    >{{ selectedFiles.length }} 个文件 ·
                    {{ (selectedFiles.reduce((n, f) => n + f.size, 0) / 1024).toFixed(1) }} KB</span
                  ><button class="text-button" :disabled="busy" @click="selectedFiles = []">
                    清空
                  </button>
                </div>
                <ul>
                  <li v-for="(f, i) in selectedFiles.slice(0, 12)" :key="i">
                    <span :title="filePath(f)">{{ filePath(f) }}</span
                    ><button
                      :disabled="busy"
                      :aria-label="`移除 ${filePath(f)}`"
                      @click="selectedFiles.splice(i, 1)"
                    >
                      ×
                    </button>
                  </li>
                </ul>
                <small v-if="selectedFiles.length > 12"
                  >另外 {{ selectedFiles.length - 12 }} 个文件将在统计时处理。</small
                >
              </div></template
            >
            <template v-else
              ><div class="text-toolbar">
                <div class="toolbar-field">
                  <span>语言</span
                  ><MeterSelect
                    v-model="language"
                    label="代码语言"
                    :disabled="busy"
                    :options="LANGUAGES.map((l) => ({ value: l.id, label: l.name }))"
                  />
                </div>
                <div class="text-actions">
                  <button class="text-button" :disabled="busy" @click="demo">填入示例</button
                  ><span class="action-divider" aria-hidden="true"></span
                  ><button class="text-button" :disabled="busy || !text" @click="clearText">
                    清空
                  </button>
                </div>
              </div>
              <label class="sr-only" for="source-text">待统计的源代码</label
              ><textarea
                id="source-text"
                ref="textInput"
                v-model="text"
                class="code-input"
                :disabled="busy"
                spellcheck="false"
                placeholder="在这里粘贴代码…"
              ></textarea>
            </template>
            <details class="input-settings">
              <summary>排除目录与输入限制</summary>
              <label>排除目录名称（逗号分隔）<input v-model="exclusions" :disabled="busy" /></label>
              <p>
                UTF-8 · 单文件 ≤5 MB · 排除目录后总量 ≤40 MB、≤2000
                个文件。文件夹入口取决于浏览器支持，不支持时请使用多文件选择。
              </p>
            </details>
            <div class="scan-actions">
              <button class="primary-button scan-button" :disabled="!canScan" @click="scan">
                {{ busy ? `${phase} · ${progress}%` : '开始统计 →' }}</button
              ><button
                v-if="busy"
                class="secondary-button"
                :disabled="phase === '保存快照'"
                @click="cancel"
              >
                取消</button
              ><button
                v-else-if="mode === 'files' && !selectedFiles.length"
                class="text-button"
                @click="demo"
              >
                或试试一段示例
              </button>
            </div>
            <progress v-if="busy" :value="progress" max="100" aria-label="统计进度"></progress>
          </div>
          <div class="overview-panel">
            <div class="section-heading">
              <div>
                <span class="section-index">02 / OVERVIEW</span>
                <h2>看见代码的轮廓</h2>
              </div>
              <span class="status-dot">{{ display ? 'SNAPSHOT' : 'READY' }}</span>
            </div>
            <div class="main-count">
              <span class="label">有效代码行</span
              ><strong>{{ display ? counts.code.toLocaleString() : '—' }}</strong
              ><span class="unit">lines of code</span>
            </div>
            <div class="mini-stats">
              <div>
                <span>纯注释</span
                ><strong>{{ display ? counts.commentOnly.toLocaleString() : '—' }}</strong>
              </div>
              <div>
                <span>空行</span
                ><strong>{{ display ? counts.blank.toLocaleString() : '—' }}</strong>
              </div>
              <div>
                <span>成功文件</span><strong>{{ display ? successful : '—' }}</strong>
              </div>
            </div>
            <div class="snapshot-caption">
              <span>{{ display ? formatTime(display.scannedAt) : '等待第一次统计' }}</span
              ><span>{{ display ? saveState || '历史快照' : '文件 / 文本 → 统计 → 快照' }}</span>
            </div>
            <p class="overview-note">
              总物理行 = 空行 + 纯注释行 + 有效代码行。<br />混合行属于代码行；行数描述规模，不代表质量或工作量。
            </p>
          </div>
        </section>
        <section class="charts-grid">
          <div class="chart-panel">
            <div class="section-heading">
              <div>
                <span class="section-index">03 / COMPOSITION</span>
                <h2>语言构成</h2>
              </div>
              <span class="muted">有效代码行占比</span>
            </div>
            <LanguagePie :languages="display?.languages ?? []" :total="counts.code" />
          </div>
          <div class="chart-panel">
            <div class="section-heading">
              <div>
                <span class="section-index">04 / ACTIVITY</span>
                <h2>扫描留下的方块</h2>
              </div>
            </div>
            <ActivityGrid :days="days" />
            <div class="change-note">
              <span>区间净变化</span
              ><strong>{{
                periodData?.comparison.value != null
                  ? (periodData.comparison.value > 0 ? '+' : '') +
                    periodData.comparison.value +
                    ' 行'
                  : '—'
              }}</strong
              ><small>{{ periodData?.comparison.reason || '可比期末快照 − 期初基线' }}</small>
            </div>
          </div>
        </section>
        <section class="files-section">
          <div class="section-heading">
            <div>
              <span class="section-index">05 / FILES</span>
              <h2>每一份文件，清清楚楚</h2>
            </div>
            <div class="export-actions">
              <button class="secondary-button" :disabled="!display" @click="exportResult('csv')">
                导出 CSV ↗</button
              ><button class="secondary-button" :disabled="!display" @click="exportResult('json')">
                导出 JSON ↗
              </button>
            </div>
          </div>
          <div class="table-controls">
            <label class="sr-only" for="file-search">搜索文件路径</label
            ><input id="file-search" v-model="search" placeholder="搜索文件路径…" /><label
              ><input v-model="onlyIssues" type="checkbox" /> 仅看异常 / 跳过（{{
                issueCount
              }}）</label
            >
            <div class="sort-select toolbar-field">
              <span>排序</span
              ><MeterSelect
                v-model="sort"
                label="排序"
                :options="[
                  { value: 'code', label: '代码行 ↓' },
                  { value: 'path', label: '路径 A–Z' },
                ]"
              />
            </div>
          </div>
          <div class="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>文件</th>
                  <th>语言</th>
                  <th>代码</th>
                  <th>注释</th>
                  <th>空行</th>
                  <th>总行</th>
                  <th>状态 / 说明</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(f, i) in fileRows" :key="f.path + i">
                  <td class="file-path">{{ f.path }}</td>
                  <td>{{ f.language ?? '—' }}</td>
                  <td>{{ f.status === 'ok' ? f.counts.code : '—' }}</td>
                  <td>{{ f.status === 'ok' ? f.counts.commentOnly : '—' }}</td>
                  <td>{{ f.status === 'ok' ? f.counts.blank : '—' }}</td>
                  <td>{{ f.status === 'ok' ? f.counts.total : '—' }}</td>
                  <td class="file-note">
                    <span>{{
                      f.status === 'ok' ? '完成' : f.status === 'skipped' ? '跳过' : '失败'
                    }}</span
                    ><small>{{ [f.reason, ...f.warnings].filter(Boolean).join('；') }}</small>
                  </td>
                </tr>
                <tr v-if="!fileRows.length">
                  <td colspan="7" class="table-empty">
                    {{
                      display
                        ? '没有符合筛选条件的文件。'
                        : '选择文件或粘贴代码，结果会出现在这里。'
                    }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="table-controls pagination-info">
            <span>显示 {{ fileRows.length }} / {{ allFileRows.length }} 个文件</span
            ><button
              v-if="fileRows.length < allFileRows.length"
              class="secondary-button"
              @click="rowLimit += 50"
            >
              再显示 50 个
            </button>
          </div>
        </section>
      </template>

      <section v-else-if="page === 'history'" class="history-section">
        <div class="section-heading">
          <div>
            <span class="section-index">HISTORY / LOCAL</span>
            <h2>{{ project?.name }} 的扫描记录</h2>
          </div>
          <span class="muted">{{ storageReady ? '保存在当前浏览器' : '浏览器存储不可用' }}</span>
        </div>
        <p class="muted">
          区间内 {{ history.length }} 次成功扫描。清除浏览器数据会删除历史；请按需导出备份。
        </p>
        <div v-if="!history.length" class="history-empty">
          还没有这个时间范围的记录。<button class="text-button" @click="page = 'workspace'">
            去统计 →
          </button>
        </div>
        <article v-for="s in history" :key="s.id" class="history-row">
          <div>
            <strong>{{ formatTime(s.scannedAt) }}</strong
            ><small>{{ s.projectName }} · {{ s.ruleVersion }}</small>
          </div>
          <div>
            <strong>{{ s.totals.code.toLocaleString() }} 行</strong
            ><small>{{ s.files.filter((f) => f.status === 'ok').length }} 个成功文件</small>
          </div>
          <div class="history-actions">
            <button class="secondary-button" @click="viewSnapshot(s)">查看结果</button
            ><button class="text-button" @click="removeSnapshot(s)">删除</button>
          </div>
        </article>
      </section>
      <section v-else class="rules-section">
        <span class="section-index">METHOD / NOT MAGIC</span>
        <h2>这份数字，怎样得到</h2>
        <div class="rule-columns">
          <article>
            <h3>物理行，不是工作量</h3>
            <p>
              含代码的行计入代码行，即使后面跟着注释。纯注释行不含代码；多行注释内部的空白行也属于注释行。文件末尾换行不会多算一行。
            </p>
            <p>格式会影响行数。不同语言的行数不能直接衡量开发难度、代码质量或成员贡献。</p>
          </article>
          <article>
            <h3>字符串中的符号保留</h3>
            <p>
              字符串里的 //、/* */、# 不当作注释。Python
              三引号字符串，包括文档字符串，默认都算代码；内部空白行也属于该字符串的代码行。
            </p>
            <p>C++ 支持常见原始字符串。未闭合的字符串或注释会列出警告。</p>
          </article>
          <article>
            <h3>初版能力边界</h3>
            <p>
              首批支持 C、C++、Python，.h 默认按 C
              处理。其他语言列入跳过清单。本版是词法状态扫描，不是完整编译器，不执行源码。
            </p>
            <p>
              复杂 Python f-string 内嵌表达式、预处理条件分支和所有 C
              翻译阶段尚未完整解析；统计结果应结合源文件及警告复查。
            </p>
          </article>
          <article>
            <h3>快照与活动</h3>
            <p>
              快照总量不叠加。活动格表示当天成功扫描次数，语言饼图对应当前展示快照。时间筛选默认显示期末快照，查看历史可选择特定快照。
            </p>
            <p>
              差值只比较相同项目和兼容规则；它是规模净变化，不是新增或删除代码的独立数量。本版历史长期保留，可手动删除。
            </p>
          </article>
        </div>
      </section>
      <footer>
        <span>code / meter<span class="footer-dot"> · </span>one line at a time.</span
        ><span>本地处理 · 无账号 · {{ RULE_VERSION }}</span>
      </footer>
    </div>
  </div>
</template>
