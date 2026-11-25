<script setup lang="ts">
import { computed, ref, toRefs, watch } from 'vue'
import { LANGUAGES, emptyCounts, supportedLanguageNames, type Snapshot } from '@/core'
import { dailyComposition } from '@/core/composition'
import { filePath, LIMITS, prepareFiles, parseExclusions } from '@/platform/files'
import type { ScanState } from '@/composables/useScan'
import type { HistoryState } from '@/composables/useHistory'
import { formatTime } from '@/utils/format'
import MeterSelect from '@/components/MeterSelect.vue'
import LanguagePie from '@/components/LanguagePie.vue'
import ActivityGrid from '@/components/ActivityGrid.vue'
import FilesReport from '@/components/FilesReport.vue'
const props = defineProps<{
  scan: ScanState
  display: Snapshot | null
  days: HistoryState['days']
  history: Snapshot[]
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
  encoding,
  exclusions,
  busy,
  progress,
  phase,
  currentFile,
  processed,
  fileTotal,
  saveState,
  canScan,
} = toRefs(props.scan)
const { addFiles, demo, scan, cancel } = props.scan
const { display } = toRefs(props)
const dragging = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const folderInput = ref<HTMLInputElement | null>(null)
const textInput = ref<HTMLTextAreaElement | null>(null)
const selection = computed(() =>
  prepareFiles(selectedFiles.value, parseExclusions(exclusions.value)),
)
const counts = computed(() => display.value?.totals ?? emptyCounts())
const successful = computed(
  () => display.value?.files.filter((file) => file.status === 'ok').length ?? 0,
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
                >已选 {{ selectedFiles.length }} 个文件 · 候选源文件
                {{ selection.candidates.length }} 个 ·
                {{ (selection.totalBytes / 1024).toFixed(1) }}
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
              >列表仅展示前 12 个，另有 {{ selectedFiles.length - 12 }} 个已选文件未列出。</small
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
          <summary>文件编码、排除目录与输入限制</summary>
          <div v-if="mode === 'files'" class="toolbar-field">
            <span>文件编码</span>
            <MeterSelect
              v-model="encoding"
              label="文件编码"
              :disabled="busy"
              :options="[
                { value: 'utf-8', label: 'UTF-8（严格）' },
                { value: 'utf-8-gbk', label: 'UTF-8 优先，失败按 GBK' },
                { value: 'gbk', label: 'GBK（全部候选文件）' },
              ]"
            />
          </div>
          <p v-if="mode === 'files'">
            混合 UTF-8 / GBK 目录可选择“UTF-8 优先，失败按 GBK”；不会自动猜测其他编码。 GBK
            解码会在文件说明中标记，原文件不会修改。若需转换，请在编辑器中以原编码打开，
            核对中文后另存为 UTF-8，再选择 UTF-8 重试。
          </p>
          <label>排除目录名称（逗号分隔）<input v-model="exclusions" :disabled="busy" /></label>
          <p>
            单文件 / 粘贴文本 ≤5 MB · 候选源文件总量 ≤40 MB、≤{{ LIMITS.maxFiles }}
            个。
            候选源文件仅包含排除目录、去重并按支持后缀筛选后的文件；不支持文件不读取、不占限额。
            .pyi 单列“Python 类型声明”，默认计入总量。文件夹入口取决于浏览器支持。
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
        <div v-if="busy" class="scan-detail" role="status" aria-live="polite">
          <span
            >{{ phase
            }}<template v-if="phase !== '保存快照'">
              · 已完成 {{ processed }} / {{ fileTotal }} 个文件</template
            ></span
          >
          <span v-if="currentFile" class="scan-file" :title="currentFile">{{ currentFile }}</span>
        </div>
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
      </div>
    </section>
    <FilesReport :snapshot="display" :scope-key="projectId" />
  </div>
</template>
