export function visibleWarnings(warnings: readonly string[]) {
  return warnings.map((warning) =>
    warning === '存在未完整识别的语法或未闭合内容；行统计基于已识别区域，请结合源码复核。'
      ? '旧快照记录了解析未完整识别提示，未保存行列位置；不代表源码有错，行分类是否受影响尚未确认。'
      : warning,
  )
}
