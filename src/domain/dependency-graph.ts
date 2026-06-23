import { baseParse } from '@vue/compiler-dom'
import { decode } from 'he'
import type {
  RootNode,
  TemplateChildNode,
  ElementNode,
} from '@vue/compiler-dom'
import { DataPath } from '@endge/raph'

export class DependencyGraphBuilder {
  id?: string
  parentId?: string

  vars: Set<string> = new Set()
  fns: Set<string> = new Set()
  varsPaths: Map<string, DataPath> = new Map()
  children: DependencyGraphBuilder[] = []

  constructor(id?: string) {
    this.id = id
  }

  /**
   * Добавляет зависимости из JSX-строки (DSL-шаблон, Vue SFC,  ...)
   */
  addJSX(jsxCode: string): void {
    if (!jsxCode) return

    const normalized = this._normalizeInterpolations(jsxCode)
    const ast = baseParse(normalized, { decodeEntities: decode })

    ast.children.forEach((node) => this._walkAndNormalize(node))
    this._generateVarPaths(ast)
  }

  private _walkAndNormalize(node: TemplateChildNode): void {
    if (node.type === 1 /* ELEMENT */) {
      this._normalizeDirectives(node)
      node.children.forEach((child) => this._walkAndNormalize(child))
    }
  }

  private _normalizeDirectives(node: ElementNode): void {
    const newProps = node.props.map((prop) => {
      if (prop.type === 6 /* ATTRIBUTE */) {
        if (prop.name === 'if' && prop.value?.content) {
          return {
            type: 7, // DIRECTIVE
            name: 'if',
            exp: {
              type: 4, // SIMPLE_EXPRESSION
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
        if (prop.name.startsWith('bind:')) {
          const argName = prop.name.slice(5)
          return {
            type: 7,
            name: 'bind',
            exp: {
              type: 4,
              content: prop.value?.content || '',
              isStatic: false,
              constType: 0,
              loc: prop.loc,
            },
            arg: {
              type: 4,
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

    for (const prop of node.props) {
      if (prop.type === 7 && prop.name === 'on' && prop.exp?.type === 4) {
        const handlerName = prop.exp.content.trim()
        if (handlerName) {
          this.fns.add(handlerName)
        }
      }
    }
  }

  private _generateVarPaths(ast: RootNode): void {
    const walk = (node: TemplateChildNode): void => {
      if (node.type === 1 /* ELEMENT */) {
        for (const prop of node.props) {
          if (
            prop.type === 7 /* DIRECTIVE */ &&
            prop.exp?.type === 4 /* SIMPLE_EXPRESSION */
          ) {
            this._collectVars(prop.exp.content)
          }
        }
        node.children.forEach(walk)
      }
      if (node.type === 5 /* INTERPOLATION */) {
        this._collectVars(node.content.content)
      }
      // Пропускаем TEXT-узлы
    }
    ast.children.forEach(walk)
  }

  private _collectVars(code: string): void {
    const dollarMatches = code.match(/\$\.[\w\d_.]+/g)
    if (dollarMatches) {
      for (const match of dollarMatches) {
        const trimmed = match.replace(/^\$\./, '')
        if (trimmed) {
          this.varsPaths.set(match, DataPath.from(trimmed))
        }
      }
    }

    const fnMatches = code.match(/\b([a-zA-Z_][\w\d_]*)\s*\(/g)
    if (fnMatches) {
      for (const fn of fnMatches) {
        const fnName = fn.replace(/\s*\($/, '')
        if (!RESERVED_WORDS.has(fnName)) {
          this.fns.add(fnName)
        }
      }
    }

    const rawMatches = code.match(/\b[a-zA-Z_][\w\d_]*\b/g)
    if (rawMatches) {
      for (const word of rawMatches) {
        if (
          !word.startsWith('$') &&
          !this.varsPaths.has(`$.${word}`) &&
          !this.fns.has(word) &&
          !RESERVED_WORDS.has(word)
        ) {
          this.vars.add(word)
        }
      }
    }

    if (code.includes('$') && code.match(/(^|\W)\$(?![\w\d.])/)) {
      this.vars.add('$')
      if (!this.varsPaths.has('$')) {
        this.varsPaths.set('$', new DataPath())
      }
    }
  }

  private _normalizeInterpolations(raw: string): string {
    return raw
      .replace(/\{([^{}]+?)\}/g, (_, expr) => {
        if (/^\s*\{\{.*\}\}\s*$/.test('{${expr}}')) return `{${expr}}`
        return `{{${expr.trim()}}}`
      })
      .replace(/\bon:([a-zA-Z0-9_]+)=/g, (_, eventName) => `@${eventName}=`)
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
