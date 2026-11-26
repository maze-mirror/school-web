import { parser as cppParser } from '@lezer/cpp'
import { parser as javaParser } from '@lezer/java'
import { parser as pythonParser } from '@lezer/python'
import { javaInput } from './modern-languages'

export const FUNCTION_RULE_VERSION = 'function-definitions-2.0'

const functionNodes: Record<string, { parser: typeof cppParser; bodies: Record<string, string> }> =
  {
    c: { parser: cppParser, bodies: { FunctionDefinition: 'CompoundStatement' } },
    cpp: { parser: cppParser, bodies: { FunctionDefinition: 'CompoundStatement' } },
    python: { parser: pythonParser, bodies: { FunctionDefinition: 'Body' } },
    java: {
      parser: javaParser,
      bodies: { MethodDeclaration: 'Block', ConstructorDeclaration: 'ConstructorBody' },
    },
  }

/** Count named definitions with bodies, not declarations, calls or lambdas. */
export function countFunctions(
  text: string,
  language: string,
  kinds?: readonly ('code' | 'comment' | 'blank')[],
): { count: number; sizes: number[]; incomplete: boolean; warning?: string } {
  const rules = functionNodes[language]
  if (!rules) return { count: 0, sizes: [], incomplete: false }

  let count = 0
  let errorCount = 0
  const sizes: number[] = []
  const { input, sourceOffset } =
    language === 'java'
      ? javaInput(text)
      : { input: text, sourceOffset: (offset: number) => offset }
  const lineStarts = [0]
  for (let offset = 0; offset < text.length; offset++) {
    if (text[offset] === '\n') lineStarts.push(offset + 1)
  }
  const lineIndexAt = (offset: number) => {
    let low = 0
    let high = lineStarts.length
    while (low + 1 < high) {
      const middle = Math.floor((low + high) / 2)
      if (lineStarts[middle]! <= offset) low = middle
      else high = middle
    }
    return low
  }
  rules.parser.parse(input).iterate({
    enter(node) {
      if (node.type.isError) errorCount++
      const bodyName = rules.bodies[node.type.name]
      if (!bodyName) return
      const body = node.node.getChild(bodyName)
      if (!body) return
      count++
      let size = 0
      const first = sourceOffset(body.from)
      const lastLine = lineIndexAt(Math.max(first, sourceOffset(body.to) - 1))
      for (let line = lineIndexAt(first); line <= lastLine; line++) {
        if (kinds?.[line] === 'code') size++
      }
      sizes.push(size)
    },
  })
  const incomplete = errorCount > 0
  return {
    count,
    sizes,
    incomplete,
    ...(incomplete
      ? {
          warning: `函数个数在可识别范围内统计，解析存在 ${errorCount} 处未识别内容，实际数量可能更多；行统计不受影响。`,
        }
      : {}),
  }
}
