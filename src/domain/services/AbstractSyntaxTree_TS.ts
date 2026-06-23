import { parse as parseTS } from '@babel/parser'
import traverse from '@babel/traverse'
import * as t from '@babel/types'

export class AbstractSyntaxTree_TS {
  private script: string
  private ast: t.File | null = null
  private usedVariables: Set<string> = new Set()
  private errors: string[] = []
  private exportedNames: Set<string> = new Set()
  private readonly globalVariables: Set<string> = new Set([
    'console',
    'window',
    'document',
    'Math',
    'JSON',
    'Date',
    'Number',
    'String',
    'Boolean',
    'Array',
    'Object',
    'Symbol',
    'BigInt',
    'undefined',
    'NaN',
    'Infinity',
  ])

  constructor(script: string) {
    this.script = script
  }

  parse(): void {
    try {
      this.ast = parseTS(this.script, {
        sourceType: 'module',
        plugins: ['typescript', 'jsx'],
      })

      traverse(this.ast, {
        Identifier: (path) => {
          if (
            t.isVariableDeclarator(path.parent, { id: path.node }) ||
            t.isFunctionDeclaration(path.parent, { id: path.node }) ||
            t.isClassDeclaration(path.parent, { id: path.node })
          ) {
            return
          }

          // ⚡️ Игнорируем property в MemberExpression (например, log в console.log)
          if (
            t.isMemberExpression(path.parent) &&
            path.parent.property === path.node
          ) {
            return
          }

          // ⚡️ Игнорируем object в MemberExpression, если это глобальный объект
          if (
            t.isMemberExpression(path.parent) &&
            path.parent.object === path.node &&
            this.globalVariables.has(path.node.name)
          ) {
            return
          }

          this.usedVariables.add(path.node.name)
        },

        ExportNamedDeclaration: (path) => {
          const decl = path.node.declaration
          if (t.isVariableDeclaration(decl)) {
            for (const d of decl.declarations) {
              if (t.isIdentifier(d.id)) {
                this.exportedNames.add(d.id.name)
              }
            }
          } else if (t.isFunctionDeclaration(decl) && decl.id) {
            this.exportedNames.add(decl.id.name)
          }
        },

        ExportSpecifier: (path) => {
          this.exportedNames.add(path.node.exported.name)
        },
      })

      // сразу извлекаем глобальные объявления
      this.extractDeclaredGlobals()
    } catch (e) {
      console.warn('[AST_TS]: Failed to parse script:', e)
    }
  }

  public extractDeclaredGlobals(): void {
    if (!this.ast) return

    traverse(
      this.ast,
      {
        FunctionDeclaration: (path) => {
          if (path.node.id?.name) {
            this.exportedNames.add(path.node.id.name)
          }
        },
        VariableDeclarator: (path) => {
          if (t.isIdentifier(path.node.id)) {
            // проверяем, что переменная в глобальной области
            const parent = path.getFunctionParent()
            if (!parent) {
              this.exportedNames.add(path.node.id.name)
            }
          }
        },
      },
      undefined,
      this,
    )
  }

  getVariables(): string[] {
    return Array.from(this.usedVariables)
  }

  validateInputFields(inputFields: Record<string, any>): void {
    for (const variable of this.usedVariables) {
      if (!this.globalVariables.has(variable) && !(variable in inputFields)) {
        this.errors.push(
          `Variable "${variable}" not found in inputFields for TS script.`,
        )
      }
    }
  }

  addError(error: string): void {
    this.errors.push(error)
  }

  getExportedNames(): Set<string> {
    return this.exportedNames
  }

  getErrors(): string[] {
    return this.errors
  }

  getAst(): t.File | null {
    return this.ast
  }
}
