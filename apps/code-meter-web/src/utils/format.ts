export function errorText(e: unknown) {
  return e instanceof Error ? e.message : '操作失败，请检查浏览器存储与输入后重试。'
}
export function formatTime(time: string) {
  return new Date(time).toLocaleString('zh-CN', { hour12: false })
}
