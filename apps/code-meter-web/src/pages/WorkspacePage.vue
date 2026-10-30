<script setup lang="ts">
import { computed, ref, toRefs, watch } from 'vue'
import { LANGUAGES, emptyCounts, localDateKey, supportedLanguageNames, type Snapshot } from '@/core'
import { dailyComposition } from '@/core/composition'
import { filePath } from '@/platform/files'
import { downloadFile, snapshotCsv, snapshotJson, snapshotXlsx } from '@/platform/storage'
import type { ScanState } from '@/composables/useScan'
import type { HistoryState } from '@/composables/useHistory'
import { formatTime, errorText } from '@/utils/format'
import { visibleWarnings } from '@/utils/visibleWarnings'
import MeterSelect from '@/components/MeterSelect.vue'
import LanguagePie from '@/components/LanguagePie.vue'
import ActivityGrid from '@/components/ActivityGrid.vue'
import ReportSummary from '@/components/ReportSummary.vue'
const props = defineProps<{
  scan: ScanState
  display: Snapshot | null
  days: HistoryState['days']
  history: Snapshot[]
  comparison: { value: number | null; reason: string } | undefined
  projectId: string
}>()
const emit = defineEmits<{ explainActivity: [] }>()
const selectedDate = ref('')
const composition = computed(() =>
  selectedDate.value ? dailyComposition(props.history, selectedDate.value) : null,
)
watch([() => props.projectId, () => props.days[0]?.date, () => props.days.at(-1)?.date], () => {
  selectedDate.value = ''
})
const {
  mode,
  selectedFiles,
  text,
  language,
  exclusions,
  busy,
  progress,
  phase,
  saveState,
  canScan,
} = toRefs(props.scan)
const { addFiles, demo, scan, cancel } = props.scan
const { display } = toRefs(props)
const dragging = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const folderInput = ref<HTMLInputElement | null>(null)
const textInput = ref<HTMLTextAreaElement | null>(null)
const search = ref('')
const onlyIssues = ref(false)
const sort = ref<'code' | 'path'>('code')
const counts = computed(() => display.value?.totals ?? emptyCounts())
const rowLimit = ref(50)
const allFileRows = computed(() => {
  const rows = (display.value?.files ?? []).filter(
    (f) =>
      f.path.toLowerCase().includes(search.value.toLowerCase()) &&
      (!onlyIssues.value || f.status !== 'ok' || visibleWarnings(f.warnings).length),
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
  () =>
    display.value?.files.filter((f) => f.status !== 'ok' || visibleWarnings(f.warnings).length)
      .length ?? 0,
)

watch(
  () => props.projectId,
  () => {
    search.value = ''
  },
)
function chooseFiles(event: Event) {
  const input = event.target as HTMLInputElement
  addFiles(Array.from(input.files ?? []))
  input.value = ''
}

function drop(event: DragEvent) {
  dragging.value = false
  addFiles(Array.from(event.dataTransfer?.files ?? []))
}

function clearText() {
  props.scan.clearText()
  textInput.value?.focus()
}
const exporting = ref(false)
const exportError = ref('')
async function exportResult(kind: 'json' | 'csv' | 'xlsx') {
  const s = display.value
  if (!s || exporting.value) return
  const name = `code-meter-${localDateKey(new Date(s.scannedAt))}`
  exporting.value = true
  exportError.value = ''
  try {
    const content =
      kind === 'xlsx' ? await snapshotXlsx(s) : kind === 'json' ? snapshotJson(s) : snapshotCsv(s)
    const mime =
      kind === 'xlsx'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : kind === 'json'
          ? 'application/json;charset=utf-8'
          : 'text/csv;charset=utf-8'
    downloadFile(`${name}.${kind}`, content, mime)
  } catch (error) {
    exportError.value = '导出失败：' + errorText(error)
  } finally {
    exporting.value = false
  }
}
</script>
<template>
  <div class="workspace-page">
    <section class="workspace-grid">
      <div class="input-panel">
        <div class="section-heading">
          <div>
            <h2 class="section-index">01 / INPUT</h2>
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
            <span class="drop-mark" aria-hidden="true">[ + ]</span><strong>把源代码放在这里</strong>
            <p>拖入文件，或从本地选择。<br />{{ supportedLanguageNames() }}</p>
            <div class="drop-actions">
              <button class="primary-button" :disabled="busy" @click="fileInput?.click()">
                选择文件 ↗</button
              ><button class="secondary-button" :disabled="busy" @click="folderInput?.click()">
                选择文件夹
              </button>
            </div>
            <small>只在此浏览器处理，不上传代码。</small>
          </div>
          <input ref="fileInput" class="sr-only" type="file" multiple @change="chooseFiles" /><input
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
                {{ (selectedFiles.reduce((n, f) => n + f.size, 0) / 1024).toFixed(1) }}
                KB</span
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
            <h2 class="section-index">02 / OVERVIEW</h2>
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
            <span>空行</span><strong>{{ display ? counts.blank.toLocaleString() : '—' }}</strong>
          </div>
          <div>
            <span>成功文件</span><strong>{{ display ? successful : '—' }}</strong>
          </div>
        </div>
        <div class="snapshot-caption">
          <span>{{ display ? formatTime(display.scannedAt) : '等待第一次统计' }}</span
          ><span>{{ display ? saveState || '历史快照' : '文件 / 文本 → 统计 → 快照' }}</span>
        </div>
        <p class="overview-note">总物理行 = 空行 + 纯注释行 + 有效代码行。</p>
      </div>
    </section>
    <section class="charts-grid">
      <div class="chart-panel">
        <div class="section-heading">
          <div>
            <h2 class="section-index">03 / COMPOSITION</h2>
          </div>
          <span class="muted">有效代码行占比</span>
        </div>
        <div class="composition-context">
          <span>{{
            selectedDate
              ? `${selectedDate} · 当天累计 · ${composition?.scans ?? 0} 次扫描`
              : '当前快照'
          }}</span>
          <button v-if="selectedDate" class="text-button" @click="selectedDate = ''">
            返回当前快照
          </button>
        </div>
        <LanguagePie
          :languages="composition?.languages ?? display?.languages ?? []"
          :total="composition?.code ?? counts.code"
          :cumulative="!!selectedDate"
        />
      </div>
      <div class="chart-panel">
        <div class="section-heading">
          <div>
            <h2 class="section-index">04 / ACTIVITY</h2>
          </div>
        </div>
        <ActivityGrid
          :days="days"
          v-model:selected-date="selectedDate"
          @explain="emit('explainActivity')"
        />
        <div class="change-note">
          <span>区间净变化</span
          ><strong>{{
            comparison?.value != null
              ? (comparison.value > 0 ? '+' : '') + comparison.value + ' 行'
              : '—'
          }}</strong
          ><small>{{ comparison?.reason || '可比期末快照 − 期初基线' }}</small>
        </div>
      </div>
    </section>
    <section class="files-section">
      <div class="section-heading">
        <div>
          <h2 class="section-index">05 / FILES</h2>
        </div>
        <div class="export-actions">
          <button
            class="secondary-button"
            :disabled="!display || exporting"
            @click="exportResult('csv')"
          >
            导出 CSV ↗</button
          ><button
            class="secondary-button"
            :disabled="!display || exporting"
            @click="exportResult('json')"
          >
            导出 JSON ↗</button
          ><button
            class="secondary-button"
            :disabled="!display || exporting"
            @click="exportResult('xlsx')"
          >
            {{ exporting ? '正在导出…' : '导出 Excel ↗' }}
          </button>
        </div>
      </div>
      <p v-if="exportError" class="notice" role="alert">{{ exportError }}</p>
      <ReportSummary :snapshot="display" />
      <div class="table-controls">
        <label class="sr-only" for="file-search">搜索文件路径</label
        ><input id="file-search" v-model="search" placeholder="搜索文件路径…" /><label
          ><input v-model="onlyIssues" type="checkbox" /> 仅看异常 / 跳过（{{ issueCount }}）</label
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
                ><small>{{
                  [f.reason, ...visibleWarnings(f.warnings)].filter(Boolean).join('；')
                }}</small>
              </td>
            </tr>
            <tr v-if="!fileRows.length">
              <td colspan="7" class="table-empty">
                {{
                  display ? '没有符合筛选条件的文件。' : '选择文件或粘贴代码，结果会出现在这里。'
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
  </div>
</template>
