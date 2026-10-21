import { parser as cppParser } from '@lezer/cpp'
import { parser as pythonParser } from '@lezer/python'

export const FUNCTION_RULE_VERSION = 'function-definitions-1.0'

/** Count named definitions with bodies, not declarations, calls or lambdas. */
export function countFunctions(
  text: string,
  language: string,
): { count: number | null; warning?: string } {
  const parser =
    language === 'python' ? pythonParser : language === 'c' || language === 'cpp' ? cppParser : null
  if (!parser) return { count: null, warning: '此语言尚未提供函数定义统计。' }
  try {
    let count = 0
    let incomplete = false
    parser.parse(text).iterate({
      enter(node) {
        if (node.type.isError) incomplete = true
        if (node.type.name === 'FunctionDefinition') count++
      },
    })
    return incomplete
      ? {
          count: null,
          warning: '语法解析存在未识别或不完整的内容，函数个数暂不可用；行统计仍保留。',
        }
      : { count }
  } catch {
    return { count: null, warning: '函数语法解析未完成；行统计仍保留。' }
  }
}
