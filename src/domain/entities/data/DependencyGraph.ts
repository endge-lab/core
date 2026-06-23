import { Endge } from '@/model/endge/endge'
import { DependencyNode } from '@/domain/entities/data/DependencyNode'
import type { RField } from '@/domain/entities/reflect/RField'
import type { DependencyEdge } from '@/domain/entities/data/DependencyEdge'
import traverse from '@babel/traverse'
import { parse } from '@babel/parser'
import * as t from '@babel/types'

export class DependencyGraph {
  private root: DependencyNode = new DependencyNode()
  private edges: DependencyEdge[] = []
  private errors: string[] = []
  private inputFields: Record<string, RField>
  private exportedNames: Set<string>

  constructor(inputFields: Record<string, RField>, exportedNames: Set<string>) {
    this.inputFields = inputFields
    this.exportedNames = exportedNames
  }

  getRoot(): DependencyNode {
    return this.root
  }

  getEdges(): DependencyEdge[] {
    return this.edges
  }

  getAllErrors(): string[] {
    return this.errors
  }

  addExpression(expression: string): void {
    // console.debug('(DependencyGraph): добавляем выражение', expression)

    let ast
    try {
      ast = parse(`(${expression})`, {
        plugins: ['typescript', 'jsx'],
        sourceType: 'module',
      })
    } catch (e) {
      this.errors.push(`Ошибка парсинга выражения "${expression}": ${e}`)
      return
    }

    traverse(ast, {
      enter: (path) => {
        if (t.isMemberExpression(path.node)) {
          const parts = this._extractParts(path.node)
          this._addPartsChain(parts)
        }

        if (t.isIdentifier(path.node) && !t.isMemberExpression(path.parent)) {
          const name = path.node.name
          if (name in this.inputFields) {
            this.findOrCreateNode(name, this.inputFields[name].type)
          } else if (this.exportedNames.has(name)) {
            this.findOrCreateNode(name, 'variable')
          } else {
            this.errors.push(
              `Field "${name}" не найден в inputFields или exportedNames`,
            )
          }
        }
      },
    })

    // console.debug('(DependencyGraph): ---------')
  }

  private _extractParts(memberExpr: t.MemberExpression): string[] {
    const parts: string[] = []
    let current: any = memberExpr
    while (t.isMemberExpression(current)) {
      if (t.isIdentifier(current.property)) {
        parts.unshift(current.property.name)
      }
      current = current.object
    }
    if (t.isIdentifier(current)) {
      parts.unshift(current.name)
    }
    return parts
  }

  private _addPartsChain(parts: string[]): void {
    const firstKey = parts[0]
    const firstField = this.inputFields[firstKey]
    if (!firstField) {
      this.errors.push(`Field "${firstKey}" не найден в inputFields`)
      return
    }

    let currentType = firstField.type
    let currentNode = this.findOrCreateNode(firstKey, currentType)

    for (let i = 1; i < parts.length; i++) {
      const part = parts[i]
      let nextNode = currentNode.children.find((c) => c.name === part)
      if (!nextNode) {
        nextNode = new DependencyNode()
        nextNode.name = part

        const typeDef = Endge.domain.getType(currentType)
        if (typeDef) {
          const field = typeDef.fields.get(part)
          if (field) {
            nextNode.type = field.type
            currentType = field.type
          }
        }

        currentNode.children.push(nextNode)
      } else {
        if (nextNode.type === 'none') {
          const typeDef = Endge.domain.getType(currentType)
          if (typeDef) {
            const field = typeDef.fields.get(part)
            if (field) {
              nextNode.type = field.type
              currentType = field.type
            }
          }
        } else {
          currentType = nextNode.type
        }
      }

      currentNode = nextNode
    }
  }

  /**
   * Ищет узел в графе по выражению вида "driver.lastName"
   * (разбивает на части и идёт по дереву)
   */
  findNodeByPath(expression: string): DependencyNode | undefined {
    const parts = expression.split('.')
    let currentNode: DependencyNode | undefined = this.root.children.find(
      (c) => c.name === parts[0],
    )
    if (!currentNode) return undefined

    for (let i = 1; i < parts.length; i++) {
      currentNode = currentNode.children.find((c) => c.name === parts[i])
      if (!currentNode) return undefined
    }

    return currentNode
  }

  findOrCreateNode(name: string, type: string = ''): DependencyNode {
    const existing = this.findNodeByName(name)
    if (existing) {
      if (type && existing.type === 'none') existing.type = type
      return existing
    }

    const node = new DependencyNode()
    node.name = name
    node.type = type
    this.root.children.push(node)
    return node
  }

  findNodeByName(
    name: string,
    currentNode: DependencyNode = this.root,
  ): DependencyNode | undefined {
    if (currentNode.name === name) {
      return currentNode
    }

    for (const child of currentNode.children) {
      const found = this.findNodeByName(name, child)
      if (found) {
        return found
      }
    }

    return undefined
  }

  addEdge(edge: DependencyEdge): void {
    this.edges.push(edge)
  }
}
