import { computed, onMounted, onBeforeUnmount, ref, type Ref, type UnwrapNestedRefs } from 'vue'
import { activityDays, localDateKey, periodSnapshots, type Snapshot } from '@/core'
import { listSnapshots, saveSnapshot, deleteSnapshot } from '@/platform/storage'
import { errorText, formatTime } from '@/utils/format'

export function useHistory(projectId: Ref<string>, notice: Ref<string>) {
  const snapshots = ref<Snapshot[]>([])
  const storageReady = ref(false)
  const period = ref('30')
  const now = new Date()
  const endDate = ref(localDateKey(now))
  now.setDate(now.getDate() - 29)
  const startDate = ref(localDateKey(now))
  const today = ref(localDateKey(new Date()))
  let clock: ReturnType<typeof setInterval> | undefined
  function refreshToday() {
    today.value = localDateKey(new Date())
  }

  const projectSnapshots = computed(() =>
    snapshots.value.filter((s) => s.projectId === projectId.value),
  )
  const range = computed(() => {
    const end = new Date(today.value + 'T00:00:00')
    end.setDate(end.getDate() + 1)
    const start = new Date(end)
    start.setDate(start.getDate() - Number(period.value === 'custom' ? 30 : period.value))
    if (period.value === 'custom') {
      const a = new Date(startDate.value + 'T00:00:00'),
        b = new Date(endDate.value + 'T00:00:00')
      b.setDate(b.getDate() + 1)
      if (!Number.isFinite(+a) || !Number.isFinite(+b) || a >= b) return null
      if ((+b - +a) / 86400000 > 366) return null
      return { start: a, end: b }
    }
    return { start, end }
  })
  const periodData = computed(() =>
    range.value
      ? periodSnapshots(snapshots.value, projectId.value, range.value.start, range.value.end)
      : null,
  )

  const days = computed(() =>
    range.value ? activityDays(projectSnapshots.value, range.value.start, range.value.end) : [],
  )
  const history = computed(() => periodData.value?.within ?? [])

  async function load() {
    try {
      snapshots.value = await listSnapshots()
      storageReady.value = true
    } catch (e) {
      notice.value = '历史无法读取：' + errorText(e) + '；仍可进行统计。'
    }
  }
  async function save(snapshot: Snapshot) {
    await saveSnapshot(snapshot)
    snapshots.value = [snapshot, ...snapshots.value.filter((s) => s.id !== snapshot.id)]
    storageReady.value = true
  }
  async function remove(snapshot: Snapshot): Promise<boolean> {
    if (
      !window.confirm(
        '删除 ' + formatTime(snapshot.scannedAt) + ' 的快照？此操作会影响活动统计与比较基线。',
      )
    )
      return false
    try {
      await deleteSnapshot(snapshot.id)
      snapshots.value = await listSnapshots()
      notice.value = '已删除快照。'
      return true
    } catch (e) {
      notice.value = errorText(e)
      return false
    }
  }
  onMounted(() => {
    refreshToday()
    clock = setInterval(refreshToday, 60000)
    window.addEventListener('focus', refreshToday)
    document.addEventListener('visibilitychange', refreshToday)
  })
  onBeforeUnmount(() => {
    if (clock) clearInterval(clock)
    window.removeEventListener('focus', refreshToday)
    document.removeEventListener('visibilitychange', refreshToday)
  })
  return {
    snapshots,
    storageReady,
    period,
    startDate,
    endDate,
    range,
    periodData,
    days,
    history,
    refreshToday,
    load,
    save,
    remove,
  }
}
export type HistoryState = UnwrapNestedRefs<ReturnType<typeof useHistory>>
