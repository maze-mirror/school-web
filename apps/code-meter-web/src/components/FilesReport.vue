<script setup lang="ts">
import { computed, onBeforeUnmount, ref, toRaw, toRef, watch } from 'vue'
import { LANGUAGES, localDateKey, type Snapshot } from '@/core'
import { downloadFile } from '@/platform/storage'
import { startExport, type ExportKind } from '@/platform/exporter'
import { errorText } from '@/utils/format'
import { visibleWarnings } from '@/utils/visibleWarnings'
import MeterSelect from '@/components/MeterSelect.vue'
import ReportSummary from '@/components/ReportSummary.vue'

const props = withDefaults(
  defineProps<{
    snapshot: Snapshot | null
    scopeKey?: string
    heading?: string
    searchId?: string
    expandLabel?: string
  }>(),
  {
    scopeKey: '',
    heading: '05 / CURRENT FILES',
    searchId: 'file-search',
    expandLabel: '再显示 50 个',
  },
)
const display = toRef(props, 'snapshot')
const search = ref('')
const onlyIssues = ref(false)
const sort = ref<'code' | 'path'>('code')
const fileLanguage = ref('all')
const languageOptions = computed(() => [
  { value: 'all', label: '全部语言' },
  ...(display.value?.languages ?? []).map((item) => ({
    value: item.language,
    label: item.name,
  })),
])
const rowLimit = ref(50)
const allFileRows = computed(() => {
  const rows = (display.value?.files ?? []).filter(
    (f) =>
      f.path.toLowerCase().includes(search.value.toLowerCase()) &&
      (fileLanguage.value === 'all' || f.language === fileLanguage.value) &&
      (!onlyIssues.value || f.status !== 'ok' || visibleWarnings(f.warnings).length),
  )
  return rows.sort((a, b) =>
    sort.value === 'code' ? b.counts.code - a.counts.code : a.path.localeCompare(b.path),
  )
})
const fileRows = computed(() => allFileRows.value.slice(0, rowLimit.value))
watch([search, onlyIssues, sort, fileLanguage, display], () => {
  rowLimit.value = 50
})
watch(display, () => {
  fileLanguage.value = 'all'
})
const successful = computed(() => display.value?.files.filter((f) => f.status === 'ok').length ?? 0)
const failed = computed(() => display.value?.files.filter((f) => f.status === 'error').length ?? 0)
const skipped = computed(
  () => display.value?.files.filter((f) => f.status === 'skipped').length ?? 0,
)
const issueCount = computed(
  () =>
    display.value?.files.filter((f) => f.status !== 'ok' || visibleWarnings(f.warnings).length)
      .length ?? 0,
)

watch(
  () => props.scopeKey,
  () => {
    search.value = ''
  },
)
const exporting = ref(false)
const exportError = ref('')
const exportStatus = ref('')
let exportTask: ReturnType<typeof startExport> | null = null
onBeforeUnmount(() => exportTask?.cancel())
async function exportResult(kind: ExportKind) {
  const s = display.value
  if (!s || exporting.value) return
  const name = `code-meter-${localDateKey(new Date(s.scannedAt))}`
  exporting.value = true
  exportError.value = ''
  const label = kind === 'xlsx' ? 'Excel' : kind.toUpperCase()
  exportStatus.value = `正在生成 ${label}，可以继续查看或筛选结果…`
  try {
    exportTask = startExport(toRaw(s), kind)
    const content = await exportTask.promise
    const mime =
      kind === 'xlsx'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : kind === 'json'
          ? 'application/json;charset=utf-8'
          : 'text/csv;charset=utf-8'
    downloadFile(`${name}.${kind}`, content, mime)
    exportStatus.value = `${label} 已生成并发起下载。`
  } catch (error) {
    exportStatus.value = ''
    exportError.value = '导出失败：' + errorText(error)
  } finally {
    exporting.value = false
    exportTask = null
  }
}
</script>
<template>
  <section class="files-section">
    <div class="section-heading">
      <div>
        <h2 class="section-index">{{ heading }}</h2>
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
    <p v-if="exportStatus" class="export-status" role="status">{{ exportStatus }}</p>
    <p v-if="display" class="result-status" :role="failed ? 'alert' : 'status'">
      当前快照：成功 {{ successful }} · 失败 {{ failed }} · 跳过 {{ skipped }}。
      <span v-if="failed">这是部分结果，合计仅包含成功文件；可勾选“仅看异常 / 跳过”查看原因。</span>
    </p>
    <ReportSummary :snapshot="display" />
    <div class="table-controls">
      <label class="sr-only" :for="searchId">搜索文件路径</label
      ><input :id="searchId" v-model="search" placeholder="搜索文件路径…" /><label
        ><input v-model="onlyIssues" type="checkbox" /> 仅看异常 / 跳过（{{ issueCount }}）</label
      >
      <div class="sort-select toolbar-field">
        <span>语言</span>
        <MeterSelect v-model="fileLanguage" label="文件语言筛选" :options="languageOptions" />
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
            <th>函数个数</th>
            <th>状态 / 说明</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(f, i) in fileRows" :key="f.path + i">
            <td class="file-path">{{ f.path }}</td>
            <td>
              {{ LANGUAGES.find((item) => item.id === f.language)?.name ?? f.language ?? '—' }}
            </td>
            <td>{{ f.status === 'ok' ? f.counts.code : '—' }}</td>
            <td>{{ f.status === 'ok' ? f.counts.commentOnly : '—' }}</td>
            <td>{{ f.status === 'ok' ? f.counts.blank : '—' }}</td>
            <td>{{ f.status === 'ok' ? f.counts.total : '—' }}</td>
            <td>
              {{ f.status === 'ok' ? (f.functionCount?.toLocaleString('zh-CN') ?? '—') : '—' }}
            </td>
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
            <td colspan="8" class="table-empty">
              {{ display ? '没有符合筛选条件的文件。' : '选择文件或粘贴代码，结果会出现在这里。' }}
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
        {{ expandLabel }}
      </button>
    </div>
  </section>
</template>
