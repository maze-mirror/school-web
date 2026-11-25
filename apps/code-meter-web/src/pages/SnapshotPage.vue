<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { Snapshot } from '@/core'
import { formatTime } from '@/utils/format'
import LanguagePie from '@/components/LanguagePie.vue'
import FilesReport from '@/components/FilesReport.vue'

const props = defineProps<{ snapshot: Snapshot }>()
const emit = defineEmits<{ back: [] }>()
const heading = ref<HTMLHeadingElement | null>(null)
const successful = computed(
  () => props.snapshot.files.filter((file) => file.status === 'ok').length,
)
onMounted(() => heading.value?.focus())
</script>

<template>
  <main class="snapshot-page" aria-label="历史扫描结果">
    <section class="snapshot-overview" aria-labelledby="snapshot-overview-title">
      <div class="section-heading">
        <h1 ref="heading" id="snapshot-overview-title" class="section-index" tabindex="-1">
          01 / OVERVIEW
        </h1>
        <button class="text-button" @click="emit('back')">← 返回扫描历史</button>
      </div>
      <div class="snapshot-metadata">
        <strong>{{ snapshot.projectName }}</strong>
        <span>{{ formatTime(snapshot.scannedAt) }}</span>
        <span>已保存快照</span>
      </div>
      <div class="snapshot-overview-grid">
        <div class="overview-panel">
          <div class="main-count">
            <span class="label">有效代码行</span>
            <strong>{{ snapshot.totals.code.toLocaleString() }}</strong>
            <span class="unit">lines of code</span>
          </div>
          <div class="mini-stats">
            <div>
              <span>纯注释</span><strong>{{ snapshot.totals.commentOnly.toLocaleString() }}</strong>
            </div>
            <div>
              <span>空行</span><strong>{{ snapshot.totals.blank.toLocaleString() }}</strong>
            </div>
            <div>
              <span>成功文件</span><strong>{{ successful.toLocaleString() }}</strong>
            </div>
          </div>
          <p class="overview-note">总物理行 = 空行 + 纯注释行 + 有效代码行。</p>
        </div>
        <div class="snapshot-composition">
          <p class="snapshot-composition-label">本次扫描的语言分布 · 有效代码行占比</p>
          <LanguagePie :languages="snapshot.languages" :total="snapshot.totals.code" />
        </div>
      </div>
    </section>
    <FilesReport
      :snapshot="snapshot"
      heading="02 / FILES"
      search-id="snapshot-file-search"
      expand-label="继续展开"
    />
  </main>
</template>
