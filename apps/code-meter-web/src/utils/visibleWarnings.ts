/** Hide deferred diagnostics in the UI without changing saved/exported data. */
const hiddenWarnings = new Set([
  '此语言尚未提供函数定义统计。',
  '语法解析存在未识别或不完整的内容，函数个数暂不可用；行统计仍保留。',
  '函数语法解析未完成；行统计仍保留。',
  '存在未完整识别的语法或未闭合内容；行统计基于已识别区域，请结合源码复核。',
])

export function visibleWarnings(warnings: readonly string[]) {
  return warnings.filter((warning) => !hiddenWarnings.has(warning))
}
