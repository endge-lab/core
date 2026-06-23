import type { DependencyGraph } from '@/domain/entities/data/DependencyGraph'
import type { DependencyNode } from '@/domain/entities/data/DependencyNode'
import type { GQLQueryNode } from '@/domain/types/types'

/**
 * Сервис для построения GraphQL-запроса из DependencyGraph.
 */
export class GraphQLBuilderService {
  /**
   * Построить JSON-структуру запроса.
   */
  buildQueryTree(graph: DependencyGraph, marker: string): GQLQueryNode | null {
    const buildNode = (node: DependencyNode): GQLQueryNode | null => {
      if (!node.markers.has(marker)) {
        return null
      }

      const childNodes: GQLQueryNode[] = []
      for (const child of node.children) {
        const childQueryNode = buildNode(child)
        if (childQueryNode) {
          childNodes.push(childQueryNode)
        }
      }

      // Преобразуем параметры в формат аргументов (если есть)
      let args: Record<string, any> | undefined = undefined
      if (node.params && node.params.size > 0) {
        args = {}
        for (const [key, values] of node.params.entries()) {
          // Преобразуем Set в массив или строку (если только 1 значение)
          const arr = Array.from(values)
          args[key] = arr.length === 1 ? arr[0] : arr
        }
      }

      const gqlNode: GQLQueryNode = { field: node.name }
      if (childNodes.length > 0) {
        gqlNode.children = childNodes
      }

      if (args) {
        ;(gqlNode as any).args = args
      }

      return gqlNode
    }

    const children = graph
      .getRoot()
      .children.map((child) => buildNode(child))
      .filter((n): n is GQLQueryNode => !!n)

    if (children.length === 1) {
      return children[0]
    } else if (children.length > 1) {
      return { field: 'root', children }
    } else {
      return null
    }
  }

  /**
   * Превращает JSON-структуру запроса в строку GraphQL.
   */
  toGraphQLString(node: GQLQueryNode, indent: string = ''): string {
    // Обработка аргументов
    let argsStr = ''
    if ('args' in node && node.args) {
      const entries = Object.entries(node.args)
      if (entries.length > 0) {
        const argsList = entries
          .map(([key, value]) => {
            if (Array.isArray(value)) {
              return `${key}: [${value.map((v) => `"${v}"`).join(', ')}]`
            } else {
              return `${key}: "${value}"`
            }
          })
          .join(', ')
        argsStr = `(${argsList})`
      }
    }

    // Базовый случай - листовой узел
    if (!node.children || node.children.length === 0) {
      return `${indent}${node.field}${argsStr}`
    }

    // Рекурсивно для детей
    const childrenStr = node.children
      .map((c) => this.toGraphQLString(c, indent + '  '))
      .join('\n')

    return `${indent}${node.field}${argsStr} {\n${childrenStr}\n${indent}}`
  }

  /**
   * Построить JSON-структуру GraphQL-запроса с типами на конечных узлах.
   */
  buildQueryJSON(
    graph: DependencyGraph,
    marker: string,
  ): Record<string, any> | null {
    const buildNode = (node: DependencyNode): any => {
      if (!node.markers.has(marker)) {
        return null
      }

      if (node.children.length === 0) {
        return node.type || 'String'
      }

      const obj: Record<string, any> = {}

      for (const child of node.children) {
        const childValue = buildNode(child)
        if (childValue !== null) {
          // Если есть аргументы, склеиваем их с именем поля
          let fieldName = child.name
          if (child.params.size > 0) {
            const paramEntries: string[] = []
            for (const [key, values] of child.params.entries()) {
              const arr = Array.from(values)
              const paramStr =
                arr.length === 1
                  ? arr[0]
                  : `[${arr.map((v) => `"${v}"`).join(', ')}]`
              paramEntries.push(`${key}: ${paramStr}`)
            }
            fieldName += `(${paramEntries.join(', ')})`
          }

          obj[fieldName] = childValue
        }
      }

      return obj
    }

    const rootChildren: Record<string, any> = {}
    for (const child of graph.getRoot().children) {
      const childValue = buildNode(child)
      if (childValue !== null) {
        let fieldName = child.name
        if (child.params.size > 0) {
          const paramEntries: string[] = []
          for (const [key, values] of child.params.entries()) {
            const arr = Array.from(values)
            const paramStr =
              arr.length === 1
                ? arr[0]
                : `[${arr.map((v) => `"${v}"`).join(', ')}]`
            paramEntries.push(`${key}: ${paramStr}`)
          }
          fieldName += `(${paramEntries.join(', ')})`
        }

        rootChildren[fieldName] = childValue
      }
    }

    if (Object.keys(rootChildren).length === 1) {
      return rootChildren
    } else if (Object.keys(rootChildren).length > 1) {
      return { root: rootChildren }
    } else {
      return null
    }
  }
}
