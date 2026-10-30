<script setup lang="ts">
import { computed } from 'vue'
import type { LanguageStat } from '@/core'
const props = defineProps<{ languages: LanguageStat[]; total: number; cumulative?: boolean }>()
const colors = [
  'var(--ink)',
  'var(--pie-2)',
  'var(--pie-3)',
  'var(--pie-4)',
  'color-mix(in srgb, var(--ink) 60%, var(--pie-2))',
  'color-mix(in srgb, var(--pie-2) 50%, var(--pie-3))',
]
const gradient = computed(() => {
  if (!props.total) return 'var(--surface)'
  let offset = 0
  const stops = props.languages
    .filter((l) => l.counts.code > 0)
    .map((l, i) => {
      const start = offset
      offset += (l.counts.code / props.total) * 100
      return `${colors[i % colors.length]} ${start}% ${offset}%`
    })
  return `conic-gradient(${stops.join(',')})`
})
</script>
<template>
  <div class="language-layout">
    <div
      class="pie"
      :style="{ background: gradient }"
      role="img"
      :aria-label="
        total ? `语言有效代码行分布，总计 ${total} 行，明细见右侧列表` : '没有有效代码行'
      "
    >
      <div class="pie-center">
        <strong>{{ total.toLocaleString() }}</strong
        ><span>code lines</span>
      </div>
    </div>
    <ul class="language-list" v-if="languages.length">
      <li v-for="(language, i) in languages" :key="language.language">
        <span class="swatch" :style="{ background: colors[i % colors.length] }"></span>
        <span
          >{{ language.name
          }}<small>{{ language.files }} {{ cumulative ? '文件次' : '个文件' }}</small></span
        >
        <span class="language-numbers"
          ><strong>{{ language.counts.code.toLocaleString() }}</strong
          ><small
            >{{ total ? ((language.counts.code / total) * 100).toFixed(1) : '0.0' }}%</small
          ></span
        >
      </li>
    </ul>
    <p v-else class="muted">
      {{ cumulative ? '当天没有已保存的扫描。' : '还没有语言数据。' }}<br />{{
        cumulative ? '可选择其他日期或返回当前快照。' : '完成一次统计后查看分布。'
      }}
    </p>
  </div>
</template>
