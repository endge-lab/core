import { RComponentBase } from '@/domain/entities/reflect/RComponentBase'
import { Exclude, Expose } from 'class-transformer'
import type {
  ElementNode,
  RootNode,
  TemplateChildNode,
} from '@vue/compiler-dom'
import { baseParse, NodeTypes } from '@vue/compiler-dom'
import { decode } from 'he'
import { DataPath } from '@endge/raph'
import { AbstractSyntaxTree_JSX } from '@/model/services/AbstractSyntaxTree_JSX'
import { Endge } from '@/model/endge/endge'
import { ENDGE_LOG_LANES } from '@/model/config/debug'

export class RComponentDSL extends RComponentBase {
  @Expose()
  jsxScript: string = ''

  @Exclude()
  ast: RootNode | null = null

  @Exclude()
  requiredVars: Set<string> = new Set()

  @Exclude()
  requiredFns: Set<string> = new Set()

  @Exclude()
  varsPaths: Map<string, DataPath> = new Map()

  constructor() {
    super()
  }

  compile(): void {
    const dbg = Endge.debug

    dbg.startSpan(ENDGE_LOG_LANES.COMPONENTS, `${this.id}`)
    super.compile()

    if (!this.jsxScript?.length) {
      dbg.warn('Отсутствует JSXScript, компиляция прервана')
      dbg.endSpan()
      return
    }

    // Создаем AST и парсим
    dbg.info('Создаём AST и парсим JSX-скрипт')
    const ast = new AbstractSyntaxTree_JSX(this.jsxScript, this.id)
    ast.parseAndBuildGraph(this.inputFields)
    this.depGraph = ast.getDependencyGraph()
    dbg.success('AST успешно создан')

    dbg.endSpan('success')

    ///
    //

    if (!this.jsxScript?.length) return

    const normalized = normalizeInterpolations(this.jsxScript)

    this.ast = baseParse(normalized, {
      decodeEntities: decode,
    })

    this.ast.children.forEach(node => walkAndNormalize(node))

    this.generateVarPaths()

    // console.log(this.ast)
    // console.log('Required Fns', this.requiredFns)
    // console.log('Required Vars', this.requiredVars)
    // console.log('Vars', this.varsPaths)
    // console.log('------')
  }

  override getDependencyComponentIds(): string[] {
    const ids: string[] = []

    if (!this.jsxScript) {
      return ids
    }

    // Парсим локально AST (не используя this.ast!)
    const normalized = this.jsxScript
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n')
      .replace(/\{([^{}]+?)\}/g, (_, expr) => {
        if (/^\s*\{\{.*\}\}\s*$/.test('{${expr}}')) return `{${expr}}`
        return `{{${expr.trim()}}}`
      })
      .replace(/\bon:([a-zA-Z0-9_]+)=/g, (_, eventName) => `@${eventName}=`)

    const ast = baseParse(normalized, { decodeEntities: decode })

    const walk = (node: TemplateChildNode): void => {
      if (node.type === NodeTypes.ELEMENT) {
        const tagName = (node as any).tag

        if (tagName === 'Component') {
          // Ищем id в атрибутах
          const idAttr = node.props.find(
            (p) => p.type === NodeTypes.ATTRIBUTE && p.name === 'id',
          )
          if (idAttr?.value?.content) {
            ids.push(idAttr.value.content)
          }
        }

        // Рекурсивно обходим потомков
        node.children.forEach((child) => walk(child))
      }
    }

    ast.children.forEach(walk)

    return ids
  }

  generateVarPaths(): void {
    if (!this.ast) return

    const walk = (node: TemplateChildNode): void => {
      if (node.type === NodeTypes.ELEMENT) {
        for (const prop of node.props) {
          if (
            prop.type === NodeTypes.DIRECTIVE &&
            prop.exp?.type === NodeTypes.SIMPLE_EXPRESSION
          ) {
            collectVars(prop.exp.content, this)
          }
        }
        node.children.forEach(walk)
      }
      if (node.type === NodeTypes.INTERPOLATION) {
        collectVars(node.content.content, this)
      }
      if (node.type === NodeTypes.TEXT) {
        return
      }
    }

    this.ast.children.forEach(walk)
  }
}

const RESERVED_WORDS = new Set([
  'true',
  'false',
  'null',
  'undefined',
  'if',
  'else',
  'for',
  'while',
  'function',
  'return',
  'console',
  'Math',
  'Object',
  'Array',
])

function collectVars(code: string, dsl: RComponentDSL): void {
  // 1. $.xxx - только в varsPaths
  const dollarMatches = code.match(/\$\.[\w\d_.]+/g)
  if (dollarMatches) {
    for (const match of dollarMatches) {
      const trimmed = match.replace(/^\$\./, '')
      if (trimmed) {
        dsl.varsPaths.set(match, DataPath.fromString(trimmed))
      }
    }
  }

  // 2. Функции вида word(...)
  const fnMatches = code.match(/\b([a-zA-Z_][\w\d_]*)\s*\(/g)
  if (fnMatches) {
    for (const fn of fnMatches) {
      const fnName = fn.replace(/\s*\($/, '')
      if (!RESERVED_WORDS.has(fnName)) {
        dsl.requiredFns.add(fnName)
      }
    }
  }

  // 3. Остальные слова (переменные)
  const rawMatches = code.match(/\b[a-zA-Z_][\w\d_]*\b/g)
  if (rawMatches) {
    for (const word of rawMatches) {
      if (
        !word.startsWith('$') &&
        !dsl.varsPaths.has(`$.${word}`) &&
        !dsl.requiredFns.has(word) &&
        !RESERVED_WORDS.has(word)
      ) {
        dsl.requiredVars.add(word)
      }
    }
  }

  // 4. Символ $ - текущий контекст
  if (code.includes('$') && code.match(/(^|\W)\$(?![\w\d.])/)) {
    dsl.requiredVars.add('$')

    if (!dsl.varsPaths.has('$')) {
      const path = new DataPath() // Пустой путь = текущий контекст
      dsl.varsPaths.set('$', path)
    }
  }
}

function walkAndNormalize(node: TemplateChildNode): void {
  if (node.type === NodeTypes.ELEMENT) {
    normalizeDirectives(node)
    node.children.forEach(child => walkAndNormalize(child))
  }
}

function normalizeDirectives(node: ElementNode): void {
  const newProps = node.props.map((prop) => {
    if (prop.type === NodeTypes.ATTRIBUTE) {
      if (prop.name === 'if' && prop.value?.content) {
        return {
          type: NodeTypes.DIRECTIVE,
          name: 'if',
          exp: {
            type: NodeTypes.SIMPLE_EXPRESSION,
            content: prop.value.content,
            isStatic: false,
            constType: 0,
            loc: prop.loc,
          },
          arg: undefined,
          modifiers: [],
          loc: prop.loc,
        }
      }
      // else-if="expr" -> DIRECTIVE(name: 'else-if', exp)
      if (prop.name === 'else-if' && prop.value?.content) {
        return {
          type: NodeTypes.DIRECTIVE,
          name: 'else-if',
          exp: {
            type: NodeTypes.SIMPLE_EXPRESSION,
            content: prop.value.content,
            isStatic: false,
            constType: 0,
            loc: prop.loc,
          },
          arg: undefined,
          modifiers: [],
          loc: prop.loc,
        }
      }

      // else (булев, без значения) -> DIRECTIVE(name: 'else')
      // Поддержим и редкий случай else="" как булев.
      if (prop.name === 'else') {
        return {
          type: NodeTypes.DIRECTIVE,
          name: 'else',
          exp: undefined, // у v-else выражения быть не должно
          arg: undefined,
          modifiers: [],
          loc: prop.loc,
        }
      }

      // (эквивалент v-for, аргументы и модификаторы не допускаются)
      if (prop.name === 'for' && prop.value?.content) {
        const expr = prop.value.content.trim()
        return {
          type: NodeTypes.DIRECTIVE,
          name: 'for',
          exp: {
            type: NodeTypes.SIMPLE_EXPRESSION,
            content: expr,
            isStatic: false,
            constType: 0,
            loc: prop.loc,
          },
          arg: undefined,
          modifiers: [],
          loc: prop.loc,
        }
      }

      if (prop.name.startsWith('bind:')) {
        const argName = prop.name.slice(5)
        return {
          type: NodeTypes.DIRECTIVE,
          name: 'bind',
          exp: {
            type: NodeTypes.SIMPLE_EXPRESSION,
            content: prop.value?.content || '',
            isStatic: false,
            constType: 0,
            loc: prop.loc,
          },
          arg: {
            type: NodeTypes.SIMPLE_EXPRESSION,
            content: argName,
            isStatic: true,
            constType: 3,
            loc: prop.loc,
          },
          modifiers: [],
          loc: prop.loc,
        }
      }
    }
    return prop
  })

  node.props = newProps
}

function normalizeInterpolations(raw: string): string {
  let output = raw
  output = output.replace(/\{([^{}]+?)\}/g, (_, expr) => {
    if (/^\s*\{\{.*\}\}\s*$/.test('{${expr}}')) return `{${expr}}`
    return `{{${expr.trim()}}}`
  })
  output = output.replace(
    /\bon:([a-zA-Z0-9_]+)=/g,
    (_, eventName) => `@${eventName}=`,
  )
  return output
}
