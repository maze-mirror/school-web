/** Hide deferred diagnostics in the UI without changing saved/exported data. */
const hiddenWarnings = new Set([
  '此语言尚未提供函数定义统计。',
  '语法解析存在未识别或不完整的内容，函数个数暂不可用；行统计仍保留。',
  '函数语法解析未完成；行统计仍保留。',
])

export function visibleWarnings(warnings: readonly string[]) {
  return warnings
    .filter((warning) => !hiddenWarnings.has(warning))
    .map((warning) =>
      warning === '存在未完整识别的语法或未闭合内容；行统计基于已识别区域，请结合源码复核。'
        ? '旧快照记录了解析未完整识别提示，未保存行列位置；不代表源码有错，行分类是否受影响尚未确认。'
        : warning,
    )
}
