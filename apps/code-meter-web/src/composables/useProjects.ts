import { computed, ref, type Ref } from 'vue'
import type { Snapshot } from '@/core'
export type Project = { id: string; name: string }

export function useProjects(notice: Ref<string>) {
  const projects = ref<Project[]>([])
  const projectId = ref('')
  const newProjectName = ref('')
  const project = computed(() => projects.value.find((p) => p.id === projectId.value))
  function persistProjects() {
    try {
      localStorage.setItem('code-meter-projects', JSON.stringify(projects.value))
      return true
    } catch {
      notice.value = '项目设置未能保存；仍可以统计和导出。'
      return false
    }
  }
  function addProject() {
    const name = newProjectName.value.trim()
    if (!name) {
      notice.value = '请输入项目名称'
      return false
    }
    const p = { id: crypto.randomUUID(), name }
    projects.value.push(p)
    projectId.value = p.id
    newProjectName.value = ''
    const saved = persistProjects()
    notice.value = saved
      ? '已建立独立项目，历史按项目分别保存。'
      : '项目设置未能保存；完成扫描后会从历史快照恢复项目，请导出备份。'
    return true
  }

  function loadSettings() {
    try {
      const raw = JSON.parse(localStorage.getItem('code-meter-projects') ?? '[]')
      if (Array.isArray(raw))
        projects.value = raw.filter(
          (p) => p && typeof p.id === 'string' && typeof p.name === 'string',
        )
    } catch {
      notice.value = '本地设置无法读取，已使用默认设置。'
    }
  }
  function restoreProjects(snapshots: Snapshot[]) {
    for (const s of snapshots) {
      if (!projects.value.some((p) => p.id === s.projectId))
        projects.value.push({ id: s.projectId, name: s.projectName })
    }
    if (!projects.value.length) projects.value = [{ id: crypto.randomUUID(), name: '我的项目' }]
    projectId.value = projects.value[0]!.id
    persistProjects()
  }
  return {
    projects,
    projectId,
    newProjectName,
    project,
    addProject,
    loadSettings,
    restoreProjects,
  }
}
