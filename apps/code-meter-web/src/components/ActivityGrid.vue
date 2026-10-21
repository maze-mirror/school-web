<script setup lang="ts">
import { computed } from 'vue'
import type { ActivityDay } from '@/core'
const props = defineProps<{ days: ActivityDay[] }>()
const selectedDate = defineModel<string>('selectedDate', { default: '' })
const emit = defineEmits<{ explain: [] }>()
const months = computed(() => {
  const groups: { key: string; label: string; padding: number; days: ActivityDay[] }[] = []
  for (const day of props.days) {
    const key = day.date.slice(0, 7)
    let group = groups.at(-1)
    if (group?.key !== key) {
      const date = new Date(day.date + 'T00:00:00')
      group = {
        key,
        label: `${date.getMonth() + 1}月`,
        padding: (date.getDay() + 6) % 7,
        days: [],
      }
      groups.push(group)
    }
    group!.days.push(day)
  }
  return groups
})
const summary = computed(() => props.days.reduce((sum, day) => sum + day.count, 0))
const scannedCode = computed(() => props.days.reduce((sum, day) => sum + day.scannedCode, 0))
const maximum = computed(() => Math.max(0, ...props.days.map((day) => day.scannedCode)))
function describe(day: ActivityDay) {
  const relative = maximum.value ? ((day.scannedCode / maximum.value) * 100).toFixed(1) : '0.0'
  return `${day.date}：累计统计 ${day.scannedCode.toLocaleString()} 行，${day.count} 次扫描，占区间峰值 ${relative}%`
}
const detail = computed(() => {
  const day = props.days.find((item) => item.date === selectedDate.value)
  return day ? describe(day) : '每一格，是一天。'
})
</script>
<template>
  <div class="activity-head">
    <span
      ><strong>{{ scannedCode.toLocaleString() }}</strong> 行累计统计 ·
      {{ summary }} 次成功扫描</span
    ><span class="muted">{{ days[0]?.date }} — {{ days.at(-1)?.date }}</span>
  </div>
  <div class="activity-calendar" :class="{ 'annual-calendar': days.length > 180 }">
    <div class="heat-weekdays" aria-hidden="true">
      <span v-for="(weekday, index) in ['一', '', '三', '', '五', '', '日']" :key="index">{{
        weekday ? `周${weekday}` : ''
      }}</span>
    </div>
    <div class="heat-scroll" tabindex="0" aria-label="活动日历，可横向滚动查看各月">
      <div class="heat-months">
        <div v-for="month in months" :key="month.key" class="heat-month" :data-month="month.key">
          <span class="heat-month-label">{{ month.label }}</span>
          <div
            class="heat-grid"
            :aria-label="`${month.key} 每日累计统计代码行，按所选区间峰值归一化`"
          >
            <span
              v-for="n in month.padding"
              :key="'pad' + n"
              class="heat-spacer"
              aria-hidden="true"
            ></span>
            <button
              v-for="day in month.days"
              :key="day.date"
              class="heat-cell"
              :class="['level-' + day.level, { 'is-selected': selectedDate === day.date }]"
              :aria-label="describe(day)"
              :aria-pressed="selectedDate === day.date"
              :title="describe(day)"
              :data-date="day.date"
              @focus="selectedDate = day.date"
              @mouseenter="selectedDate = day.date"
              @click="selectedDate = day.date"
            ></button>
          </div>
        </div>
      </div>
    </div>
  </div>
  <p class="heat-detail muted" aria-live="polite">{{ detail }}</p>
  <div class="heat-footer">
    <a href="#activity-method" @click.prevent="emit('explain')">我们是怎样统计的 ↗</a>
    <div class="heat-legend">
      <span>少</span><i v-for="n in 5" :key="n" class="heat-cell" :class="'level-' + (n - 1)"></i
      ><span>多</span>
    </div>
  </div>
  <p class="micro">
    {{
      maximum ? `区间峰值 ${maximum.toLocaleString()} 行 = 最深色` : '当前区间没有非零统计量'
    }}；重复扫描计入当天累计统计量。
  </p>
</template>
