import { baseParse, NodeTypes } from '@vue/compiler-dom'
import type { RootNode, TemplateChildNode } from '@vue/compiler-dom'
import { decode } from 'he'
import { DependencyGraph } from '@/domain/entities/data/DependencyGraph'
import type { RField } from '@/domain/entities/reflect/RField'
import { DataPath } from '@endge/raph'
import { Endge } from '@/model/endge/endge'

/**
 * Класс для парсинга JSX-скрипта компонента:
 * - строит DependencyGraph
 * - сразу создаёт DependencyEdge для связей с дочерними компонентами (Aegis)
 */
export class AbstractSyntaxTree_JSX {
  private jsxCode: string
  private ast: RootNode | null = null
  private dependencyGraph: DependencyGraph | null = null
  private exportedNames: Set<string> = new Set()
  private meId: string

  constructor(jsxCode: string, meId: string) {
    this.jsxCode = jsxCode
    this.meId = meId
  }

  /**
   * Парсит JSX-скрипт, сразу строя локальный DependencyGraph и Aegis-связи.
   */
  public parseAndBuildGraph(
    inputFields: Record<string, RField>,
    exportedNames: Set<string> = new Set(),
  ): void {
    // Нормализуем и парсим AST
    const normalized = this._normalizeInterpolations(this.jsxCode)
    this.ast = baseParse(normalized, { decodeEntities: decode })

    // Создаём DependencyGraph
    this.dependencyGraph = new DependencyGraph(inputFields, exportedNames)

    // Обход AST: сразу добавляем локальные узлы и строим edges для подкомпонентов
    this.ast.children.forEach((node) => this._walk(node))
  }

  /**
   * Рекурсивно обходит AST-узлы:
   * - Добавляет зависимости (DependencyNode) для выражений
   * - Строит DependencyEdge для Component
   */
  private _walk(node: TemplateChildNode): void {
    if (node.type === NodeTypes.ELEMENT) {
      const isComponent = (node as any).tag === 'Component'

      for (const prop of node.props) {
        if (
          prop.type === NodeTypes.DIRECTIVE &&
          prop.exp?.type === NodeTypes.SIMPLE_EXPRESSION
        ) {
          const expr = prop.exp.content.trim()

          // 1Добавляем зависимость (локальный узел)
          this.dependencyGraph!.addExpression(expr)

          // 2Если это Component с привязкой - строим DependencyEdge
          if (isComponent && prop.arg?.type === NodeTypes.SIMPLE_EXPRESSION) {
            const inputFieldName = prop.arg.content.trim()
            const sourceExpr = expr

            // ИСПРАВЛЕНО: используем findNodeByPath для цепочек!
            const fromNode = this.dependencyGraph!.findNodeByPath(sourceExpr)
            if (!fromNode) {
              console.warn(
                `[AST_JSX]: Не найден DependencyNode для "${sourceExpr}" в родителе`,
              )
              continue
            }

            // Получаем подкомпонент и входной узел
            const idAttr = node.props.find(
              (p) => p.type === NodeTypes.ATTRIBUTE && p.name === 'id',
            )
            const childId = idAttr?.value?.content
            if (!childId) continue

            const childComponent = Endge.domain.getComponent(childId)
            if (!childComponent || !childComponent.depGraph) continue

            const toNode =
              childComponent.depGraph.findNodeByName(inputFieldName)
            if (!toNode) {
              console.warn(
                `[AST_JSX]: Не найден DependencyNode для "${inputFieldName}" в подкомпоненте "${childId}"`,
              )
              continue
            }

            // Создаём DataPath
            const dataPath = DataPath.from(sourceExpr)

            // Добавляем edge
            this.dependencyGraph?.addEdge({
              name: `from_node(${fromNode.name}, ${this.meId}), to_node(${toNode.name}, ${childId})`,
              from: fromNode,
              to: toNode,
              path: dataPath,
            })

            console.debug(
              `[AST_JSX]: Добавлен DependencyEdge ${sourceExpr} -> ${inputFieldName} (${childId})`,
            )
          }
        }
      }

      // Рекурсивно обходим потомков
      node.children.forEach((child) => this._walk(child))
    }

    if (node.type === NodeTypes.INTERPOLATION) {
      const expr = node.content.content.trim()
      this.dependencyGraph!.addExpression(expr)
    }
  }

  /**
   * Возвращает локальный DependencyGraph.
   */
  getDependencyGraph(): DependencyGraph | null {
    return this.dependencyGraph
  }

  private _normalizeInterpolations(raw: string): string {
    const noTSComments = raw
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n')

    return noTSComments
      .replace(/\{([^{}]+?)\}/g, (_, expr) => {
        if (/^\s*\{\{.*\}\}\s*$/.test('{${expr}}')) return `{${expr}}`
        return `{{${expr.trim()}}}`
      })
      .replace(/\bon:([a-zA-Z0-9_]+)=/g, (_, eventName) => `@${eventName}=`)
  }
}
