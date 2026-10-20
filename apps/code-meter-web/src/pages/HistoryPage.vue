<script setup lang="ts">
import type { Snapshot } from '@/core'
import { formatTime } from '@/utils/format'
defineProps<{
  projectName: string
  history: Snapshot[]
  storageReady: boolean
}>()
const emit = defineEmits<{
  view: [snapshot: Snapshot]
  remove: [snapshot: Snapshot]
  workspace: []
}>()
</script>
<template>
  <section class="history-section">
    <div class="section-heading">
      <div>
        <span class="section-index">HISTORY / LOCAL</span>
        <h2>{{ projectName }} 的扫描记录</h2>
      </div>
      <span class="muted">{{ storageReady ? '保存在当前浏览器' : '浏览器存储不可用' }}</span>
    </div>
    <p class="muted">
      区间内
      {{ history.length }}
      次成功扫描。清除浏览器数据会删除历史；请按需导出备份。
    </p>
    <div v-if="!history.length" class="history-empty">
      还没有这个时间范围的记录。<button class="text-button" @click="emit('workspace')">
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
        <button class="secondary-button" @click="emit('view', s)">查看结果</button
        ><button class="text-button" @click="emit('remove', s)">删除</button>
      </div>
    </article>
  </section>
</template>
