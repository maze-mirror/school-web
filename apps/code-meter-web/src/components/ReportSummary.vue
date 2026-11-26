<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  buildReport,
  REPORT_COLUMNS,
  REPORT_COLUMNS_FUNCTIONS,
  type ReportColumnKey,
  type ReportRow,
} from '@/core/report'
import type { Snapshot } from '@/core'
const props = defineProps<{ snapshot: Snapshot | null }>()
const mode = ref<'file' | 'function'>('file')
const columns = computed(() => [
  ...REPORT_COLUMNS.slice(0, 6),
  ...(mode.value === 'file' ? REPORT_COLUMNS.slice(6) : REPORT_COLUMNS_FUNCTIONS),
])
const report = computed(() => (props.snapshot ? buildReport(props.snapshot) : null))
const rows = computed(() => (report.value ? [...report.value.byLanguage, report.value.total] : []))
function format(value: ReportRow[ReportColumnKey]): string {
  if (value == null) return '—'
  return typeof value === 'number'
    ? value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
    : value
}
</script>
<template>
  <div class="report-summary">
    <div class="summary-toolbar">
      <div class="segmented" role="group" aria-label="代码行分布方式">
        <button type="button" :aria-pressed="mode === 'file'" @click="mode = 'file'">按文件</button>
        <button type="button" :aria-pressed="mode === 'function'" @click="mode = 'function'">
          按函数
        </button>
      </div>
    </div>
    <div class="table-scroll">
      <table aria-label="按语言汇总统计">
        <thead>
          <tr>
            <th v-for="column in columns" :key="column.key" scope="col">
              {{ column.label }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.language">
            <th scope="row">{{ row.language }}</th>
            <td v-for="column in columns.slice(1)" :key="column.key">
              {{ format(row[column.key]) }}
              <template
                v-if="
                  column.key === 'functionCount' &&
                  row === report?.total &&
                  row.functionCount != null &&
                  row.functionLanguageCoverage &&
                  row.functionLanguageCoverage.counted < row.functionLanguageCoverage.total
                "
                >（基于 {{ row.functionLanguageCoverage.counted }}/{{
                  row.functionLanguageCoverage.total
                }}
                种语言）</template
              >
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td :colspan="columns.length" class="table-empty">统计后显示语言汇总。</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="micro">
      {{
        mode === 'file'
          ? '最大值、最小值、均值和中位数按各源文件的有效代码行计算。'
          : '最大值、最小值、均值和中位数按各函数的有效代码行计算，不含空行与纯注释行。'
      }}
    </p>
  </div>
</template>

<style scoped>
.summary-toolbar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 12px;
}
table {
  table-layout: fixed;
  width: 100%;
}
</style>
