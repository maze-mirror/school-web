<script setup lang="ts">
import { computed, ref } from 'vue'
const props = defineProps<{ days: { date: string; count: number; level: number }[] }>()
const detail = ref('')
const padding = computed(() => {
  const first = props.days[0]
  return first ? new Date(first.date + 'T00:00:00').getDay() : 0
})
const summary = computed(() => props.days.reduce((sum, day) => sum + day.count, 0))
</script>
<template>
  <div class="activity-head">
    <span
      ><strong>{{ summary }}</strong> 次成功扫描</span
    ><span class="muted">{{ days[0]?.date }} — {{ days.at(-1)?.date }}</span>
  </div>
  <div class="heat-scroll">
    <div class="heat-grid" aria-label="每日成功扫描次数">
      <span v-for="n in padding" :key="'pad' + n" class="heat-spacer"></span>
      <button
        v-for="day in days"
        :key="day.date"
        class="heat-cell"
        :class="'level-' + day.level"
        :aria-label="`${day.date}：${day.count} 次成功扫描`"
        :title="`${day.date}：${day.count} 次成功扫描`"
        @focus="detail = `${day.date} · ${day.count} 次成功扫描`"
        @mouseenter="detail = `${day.date} · ${day.count} 次成功扫描`"
        @click="detail = `${day.date} · ${day.count} 次成功扫描`"
      ></button>
    </div>
  </div>
  <div class="heat-footer">
    <span class="muted" aria-live="polite">{{ detail || '每一格，是一天。' }}</span>
    <div class="heat-legend">
      <span>少</span><i v-for="n in 5" :key="n" class="heat-cell" :class="'level-' + (n - 1)"></i
      ><span>多</span>
    </div>
  </div>
  <p class="micro">灰阶档位：0 / 1 / 2–3 / 4–6 / ≥7 次。扫描活动不代表实际代码产出。</p>
</template>
