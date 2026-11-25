import { expect, it } from 'vitest'
import { visibleWarnings } from '../visibleWarnings'

it('shows legacy parser notes without inventing locations or changing stored warnings', () => {
  const original = [
    '存在未完整识别的语法或未闭合内容；行统计基于已识别区域，请结合源码复核。',
    '函数语法解析未完成；行统计仍保留。',
  ]
  const stored = [...original]
  const visible = visibleWarnings(original)
  expect(visible).toHaveLength(1)
  expect(visible[0]).toContain('旧快照')
  expect(visible[0]).toContain('未保存行列位置')
  expect(original).toEqual(stored)
})
