<script setup lang="ts">
import type { Project } from '@/composables/useProjects'
import MeterSelect from './MeterSelect.vue'
defineProps<{ projects: Project[]; busy: boolean; allowCreate: boolean }>()
const projectId = defineModel<string>('projectId', { required: true })
const newProjectName = defineModel<string>('newProjectName', {
  required: true,
})
const period = defineModel<string>('period', { required: true })
const startDate = defineModel<string>('startDate', { required: true })
const endDate = defineModel<string>('endDate', { required: true })
const emit = defineEmits<{
  projectChange: []
  periodChange: []
  addProject: []
}>()
</script>
<template>
  <section class="project-toolbar" aria-label="项目与时间筛选">
    <div class="toolbar-field">
      <span>项目</span
      ><MeterSelect
        v-model="projectId"
        label="项目"
        :disabled="busy"
        :options="projects.map((p) => ({ value: p.id, label: p.name }))"
        @change="emit('projectChange')"
      />
    </div>
    <form v-if="allowCreate" class="project-create" @submit.prevent="emit('addProject')">
      <label class="sr-only" for="project-name">新统计档案名称</label
      ><input
        id="project-name"
        v-model="newProjectName"
        placeholder="新统计档案名称"
        title="建立统计档案，扫描时再选择本地文件或文件夹。"
        maxlength="60"
        :disabled="busy"
      /><button class="secondary-button" :disabled="busy || !newProjectName.trim()">
        ＋ 新建档案
      </button>
    </form>
    <div class="period-select toolbar-field">
      <span>时间</span
      ><MeterSelect
        v-model="period"
        label="时间"
        :options="[
          { value: '7', label: '一周 · 7 天' },
          { value: '30', label: '一月 · 30 天' },
          { value: '365', label: '一年 · 365 天' },
          { value: 'custom', label: '自选日期' },
        ]"
        @change="emit('periodChange')"
      />
    </div>
    <template v-if="period === 'custom'"
      ><label>开始<input v-model="startDate" type="date" @change="emit('periodChange')" /></label
      ><label>结束<input v-model="endDate" type="date" @change="emit('periodChange')" /></label
    ></template>
  </section>
</template>
