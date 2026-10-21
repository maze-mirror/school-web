<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { RULE_VERSION, type Snapshot } from '@/core'
import { useProjects } from '@/composables/useProjects'
import { useHistory } from '@/composables/useHistory'
import { useScan } from '@/composables/useScan'
import { useTheme } from '@/composables/useTheme'
import MeterSelect from '@/components/MeterSelect.vue'
import ProjectToolbar from '@/components/ProjectToolbar.vue'
import WorkspacePage from '@/pages/WorkspacePage.vue'
import HistoryPage from '@/pages/HistoryPage.vue'
import RulesPage from '@/pages/RulesPage.vue'

const page = ref<'workspace' | 'history' | 'rules'>('workspace')
const introductionTarget = ref('')
function openIntroduction(target = '') {
  introductionTarget.value = target
  page.value = 'rules'
}
const notice = ref('')
const { projects, projectId, newProjectName, project, addProject, loadSettings, restoreProjects } =
  useProjects(notice)
const { theme, setTheme, loadTheme } = useTheme(notice)
const historyState = reactive(useHistory(projectId, notice))
const scanState = reactive(
  useScan({
    project,
    notice,
    save: historyState.save,
    refreshToday: historyState.refreshToday,
    onResult: () => {
      page.value = 'workspace'
    },
    hasDisplay: (): boolean => !!display.value,
  }),
)
const display = computed(() =>
  scanState.current?.projectId === projectId.value
    ? scanState.current
    : (historyState.periodData?.last ?? null),
)
function changeProject() {
  scanState.current = null
  scanState.saveState = ''
}
function createProject() {
  if (addProject()) changeProject()
}
function viewSnapshot(snapshot: Snapshot) {
  scanState.current = snapshot
  page.value = 'workspace'
  scanState.saveState = '历史快照'
}
async function removeSnapshot(snapshot: Snapshot) {
  if (await historyState.remove(snapshot)) {
    if (scanState.current?.id === snapshot.id) scanState.current = null
  }
}
onMounted(async () => {
  loadSettings()
  loadTheme()
  await historyState.load()
  restoreProjects(historyState.snapshots)
})
</script>
<template>
  <div class="meter-app" :data-theme="theme">
    <div class="top-strip" aria-hidden="true">
      <div class="strip-track">
        <span v-for="n in 8" :key="n"
          >□ READ THE CODE　 ■ COUNT WHAT MATTERS　 □ ONE LINE AT A TIME　</span
        >
      </div>
    </div>
    <div class="page-shell">
      <header class="site-header">
        <a class="brand" href="#" @click.prevent="page = 'workspace'"
          ><span class="brand-mark">■</span> code / meter<span class="version">v0.1</span></a
        >
        <nav aria-label="页面导航">
          <button
            :aria-current="page === 'workspace' ? 'page' : undefined"
            @click="page = 'workspace'"
          >
            工作台</button
          ><button
            :aria-current="page === 'history' ? 'page' : undefined"
            @click="page = 'history'"
          >
            扫描历史</button
          ><button
            :aria-current="page === 'rules' ? 'page' : undefined"
            @click="openIntroduction()"
          >
            项目介绍
          </button>
        </nav>
        <div class="theme-select">
          <MeterSelect
            v-model="theme"
            label="主题配色"
            :options="[
              { value: 'mono', label: '原色' },
              { value: 'dark', label: '暗色' },
            ]"
            @change="setTheme"
          />
        </div>
      </header>
      <section class="intro">
        <div>
          <p class="eyebrow">A SMALL TOOL FOR YOUR SOURCE.</p>
          <h1>
            {{
              page === 'history'
                ? 'Every scan, a trace.'
                : page === 'rules'
                  ? 'Define before counting.'
                  : 'Code, without the noise.'
            }}
          </h1>
          <p class="intro-copy">
            {{
              page === 'history'
                ? '每一次扫描，留下可复查的记录。'
                : page === 'rules'
                  ? '知道怎样计算，才知道数字意味着什么。'
                  : '去掉空行与注释，看见代码本身。'
            }}
          </p>
        </div>
      </section>

      <ProjectToolbar
        v-if="page !== 'rules'"
        :projects="projects"
        :busy="scanState.busy"
        :allow-create="page === 'workspace'"
        v-model:project-id="projectId"
        v-model:new-project-name="newProjectName"
        v-model:period="historyState.period"
        v-model:start-date="historyState.startDate"
        v-model:end-date="historyState.endDate"
        @project-change="changeProject"
        @period-change="scanState.current = null"
        @add-project="createProject"
      />
      <p v-if="page !== 'rules' && !historyState.range" class="notice" role="alert">
        请选择有效日期范围；自定义范围最多 366 天。
      </p>
      <div v-if="notice" class="notice" role="status">
        <span class="notice-mark" aria-hidden="true">i</span>
        <p>{{ notice }}</p>
        <button type="button" class="notice-close" aria-label="关闭提示" @click="notice = ''">
          ×
        </button>
      </div>
      <!-- Keep the workspace mounted so navigation preserves input, filters and file controls. -->
      <WorkspacePage
        v-show="page === 'workspace'"
        :scan="scanState"
        :display="display"
        :days="historyState.days"
        :history="historyState.history"
        :comparison="historyState.periodData?.comparison"
        :project-id="projectId"
        @explain-activity="openIntroduction('activity-method')"
      />
      <HistoryPage
        v-if="page === 'history'"
        :project-name="project?.name ?? ''"
        :history="historyState.history"
        :storage-ready="historyState.storageReady"
        @view="viewSnapshot"
        @remove="removeSnapshot"
        @workspace="page = 'workspace'"
      />
      <RulesPage v-if="page === 'rules'" :target="introductionTarget" />
      <footer>
        <span>code / meter<span class="footer-dot"> · </span>one line at a time.</span
        ><span>本地处理 · 无账号 · {{ RULE_VERSION }}</span>
      </footer>
    </div>
  </div>
</template>
