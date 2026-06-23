import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import * as t from '@babel/types'

export interface MemoryLink {
  query: string
  mount: string
}

export class ScenarioScriptBuilderService {
  /**
   * Ошибки, найденные при анализе
   */
  errors: string[] = []

  /**
   * Структура: memoryId -> { query: string, mount: string }
   */
  memoryLinks: Record<string, MemoryLink> = {}

  /**
   * Анализирует TypeScript-скрипт сценария.
   * Результат сохраняется в свойствах this.errors и this.memoryLinks.
   */
  analyze(script: string): void {
    this.errors = []
    this.memoryLinks = {}

    let ast
    try {
      ast = parse(script, {
        plugins: ['typescript'],
        sourceType: 'module',
      })
    } catch (e) {
      this.errors.push(`Ошибка парсинга: ${e}`)
      return
    }

    const temp: Record<string, Partial<MemoryLink>> = {}

    const getFirstArgAsString = (call: t.CallExpression) => {
      const arg = call.arguments[0]
      return t.isStringLiteral(arg) ? arg.value : undefined
    }

    traverse(ast, {
      CallExpression: (path) => {
        const { node } = path

        if (!t.isIdentifier(node.callee)) return

        if (node.callee.name === 'query') {
          const queryName = getFirstArgAsString(node)
          if (!queryName) {
            this.errors.push('query() должен содержать строковый аргумент')
            return
          }

          let memoryId = 'default'
          const parent = path.parentPath?.parent
          if (
            t.isCallExpression(parent) &&
            t.isMemberExpression(parent.callee)
          ) {
            if (
              t.isIdentifier(parent.callee.property) &&
              parent.callee.property.name === 'to'
            ) {
              const memArg = getFirstArgAsString(parent)
              if (memArg) memoryId = memArg
            }
          }

          if (!temp[memoryId]) temp[memoryId] = {}
          temp[memoryId].query = queryName
        }

        if (node.callee.name === 'mount') {
          const mountName = getFirstArgAsString(node)
          if (!mountName) {
            this.errors.push('mount() должен содержать строковый аргумент')
            return
          }

          let memoryId = 'default'
          const parent = path.parentPath?.parent
          if (
            t.isCallExpression(parent) &&
            t.isMemberExpression(parent.callee)
          ) {
            if (
              t.isIdentifier(parent.callee.property) &&
              parent.callee.property.name === 'from'
            ) {
              const memArg = getFirstArgAsString(parent)
              if (memArg) memoryId = memArg
            }
          }

          if (!temp[memoryId]) temp[memoryId] = {}
          temp[memoryId].mount = mountName
        }
      },
    })

    // Проверяем, что найдены оба элемента
    for (const [memId, link] of Object.entries(temp)) {
      if (!link.query || !link.mount) {
        this.errors.push(
          `Для memory "${memId}" не найдены обе части (query=${link.query}, mount=${link.mount})`,
        )
      } else {
        this.memoryLinks[memId] = {
          query: link.query,
          mount: link.mount,
        }
      }
    }
  }
}
