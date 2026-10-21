<script setup lang="ts">
import { computed } from 'vue'
import { buildReport, REPORT_COLUMNS, type ReportRow } from '@/core/report'
import type { Snapshot } from '@/core'
const props = defineProps<{ snapshot: Snapshot | null }>()
const report = computed(() => (props.snapshot ? buildReport(props.snapshot) : null))
const rows = computed(() => (report.value ? [...report.value.byLanguage, report.value.total] : []))
function format(value: ReportRow[keyof ReportRow]): string {
  if (value == null) return '—'
  return typeof value === 'number'
    ? value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
    : value
}
</script>
<template>
  <div class="report-summary">
    <div class="table-scroll">
      <table aria-label="按语言汇总统计">
        <thead>
          <tr>
            <th v-for="column in REPORT_COLUMNS" :key="column.key" scope="col">
              {{ column.label }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.language">
            <th scope="row">{{ row.language }}</th>
            <td v-for="column in REPORT_COLUMNS.slice(1)" :key="column.key">
              {{ format(row[column.key]) }}
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td :colspan="REPORT_COLUMNS.length" class="table-empty">统计后显示语言汇总。</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="micro">
      最大值、最小值、均值和中位数按各源文件的有效代码行计算；函数个数未记录或不可用时显示 —。
    </p>
  </div>
</template>
