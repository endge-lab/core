import { RComponentBase } from '@/domain/entities/reflect/RComponentBase'
import type { RComponentTableColumn } from '@/domain/entities/reflect/RComponentTableColumn'
import { RComponentTableColumn_isHtml } from '@/domain/entities/reflect/RComponentTableColumn'
import { RComponentTableColumn_isComponent } from '@/domain/entities/reflect/RComponentTableColumn'
import { Endge } from '@/model/endge/endge'
import { DependencyNode } from '@/domain/entities/data/DependencyNode'
import { DataPath } from '@endge/raph'
import { Exclude } from 'class-transformer'
import type { RaphNode } from '@endge/raph'
import { Raph } from '@endge/raph'
import type { ExecuteOptions } from '@/domain/types/runtime.types'
import type { TableBinding } from '@/domain/types/models.types'
import { ENDGE_LOG_LANES } from '@/model/config/debug'

export class RComponentTable extends RComponentBase {
  //
  columns: Array<RComponentTableColumn> = []

  // источник данных для таблицы (берет количество элементов для revoGrid)
  sourceIndex: string = ''

  bindings: TableBinding = { keys: {} }

  // Высота строки
  // zoom - рассчитывается от настроек зума
  rowSize: string | number | 'zoom' = 40

  @Exclude()
  dataPaths: Set<string> = new Set()

  constructor() {
    super()
  }

  compile(): void {
    const dbg = Endge.debug
    dbg.startSpan(ENDGE_LOG_LANES.COMPONENTS, `${this.id}`)

    super.compile()

    //
    const rootGraph = this.depGraph!
    const rootNode = rootGraph.getRoot()

    // Для каждой колонки собираем DataPath.
    //
    this.dataPaths.clear()

    this.columns.forEach((column) => {
      if (!column.isActive) return

      // ToDo: Deprecated
      if (RComponentTableColumn_isHtml(column)) {
        this.addValidationError(
          `@Deprecated: Колонка "${column.title}" использует устаревший тип "Html"`,
        )
        return
      }

      if (RComponentTableColumn_isComponent(column) && column.componentId) {
        const childComponent = Endge.domain.getComponent(column.componentId)
        if (!childComponent) {
          this.addValidationError(
            `В колонке "${column.title}" указан неизвестный компонент с id "${column.componentId}".`,
          )
          return
        }

        const weight = Object.values(column.dataPaths)?.length || 100

        Object.values(column.dataPaths).forEach((dataPath) => {
          dbg.debug(
            `Обрабатываем DataPath для колонки "${column.title}": ${dataPath.toString()}`,
          )

          this.dataPaths.add(dataPath)
          const sourceField = this.inputFields?.[this.sourceIndex]

          const dpObject = DataPath.from(dataPath)

          const newNode = DependencyNode.fromDataPath(
            dpObject,
            this.inputFields[sourceField?.name]?.type,
          )
          rootNode.addChild(newNode)
        })
      }
    })

    // Добавляем зависимости (DependencyEdge) между текущей таблицей и дочерними компонентами
    this.columns.forEach((column) => {
      if (!column.isActive) return

      if (RComponentTableColumn_isComponent(column) && column.componentId) {
        const childComponent = Endge.domain.getComponent(column.componentId)
        if (!childComponent || !childComponent.depGraph) {
          this.addValidationError(
            `В колонке "${column.title}" указан неизвестный или некомпилируемый компонент с id "${column.componentId}".`,
          )
          return
        }

        Object.keys(childComponent.inputFields).forEach((inputFieldName) => {
          const dataPath = column.dataPaths[inputFieldName]
          if (!dataPath) {
            this.addValidationError(
              `В колонке "${column.title}" отсутствует DataPath для входного поля "${inputFieldName}" дочернего компонента "${childComponent.name}".`,
            )
            return
          }

          const fromNode = this.findNodeByDataPath(dataPath, rootNode)
          if (!fromNode) {
            this.addValidationError(
              `Не найдена DependencyNode для DataPath "${dataPath.toString()}" в компоненте "${this.name}".`,
            )
            return
          }

          const toNode = childComponent.depGraph.findNodeByName(inputFieldName)
          if (!toNode) {
            this.addValidationError(
              `Не найден DependencyNode для входного поля "${inputFieldName}" в дочернем компоненте "${childComponent.name}".`,
            )
            return
          }

          rootGraph.addEdge({
            name: `from_node(${fromNode.name}, ${this.id}), to_node(${toNode.name}, ${childComponent.id})`,
            from: fromNode,
            to: toNode,
          })

          dbg.debug(
            `Добавлен DependencyEdge: ${fromNode.name} -> ${toNode.name} (DataPath: ${dataPath.toString()})`,
          )
        })

        // Присоединяем дочерние узлы (мерджинг) для создания общего дерева
        const childRoot = childComponent.depGraph.getRoot()
        childRoot.children.forEach((child) => rootNode.addChild(child))
      }
    })

    dbg.endSpan('success')
  }

  execute(options: ExecuteOptions): RaphNode {
    const node = super.execute({
      ...options,
      meta: {
        ...options.meta,
        kind: 'root',
      },
    })
    Raph.app.track(node, `${options.basePath}.*`, {
      vars: {
        store: options.basePath,
      },
      wildcardDynamic: true,
    })

    this.columns.forEach((column, index) => {
      if (RComponentTableColumn_isHtml(column)) return
      if (!column.isActive || !column.componentId) return

      const columnComponent = Endge.domain.getComponent(column.componentId)
      if (!columnComponent) {
        console.error(
          `[RComponentTable] Не найден компонент колонки по id ${column.componentId}`,
        )
        return
      }

      //
      // Добавляем каждую колонку, как дочерний узел
      const childNode = columnComponent.execute({
        ...options,
        meta: {
          ...options.meta,
          columnIndex: index,
          kind: 'boundary',
        },
      })
      Raph.app.addDependency(node, childNode)

      //
      // Все зависимые данные колонок (маски)
      const masks = Object.values(column.dataPaths).map((dataPath) => {
        return dataPath
      })
      masks.forEach((mask) => {
        Raph.app.track(childNode, `${mask}[*]`, {
          vars: {
            store: options.basePath,
          },
          wildcardDynamic: true,
        })
      })
    })

    return node
  }

  /**
   * Рекурсивно находит конечный DependencyNode по dataPath.
   */
  private findNodeByDataPath(
    dataPath: DataPath,
    currentNode: DependencyNode,
  ): DependencyNode | undefined {
    // Пропускаем '$', если оно в начале
    if (dataPath.key === '$') {
      if (dataPath.value) {
        return this.findNodeByDataPath(dataPath.value, currentNode)
      }
      return currentNode
    }

    // Ищем ноду с именем dataPath.key
    const nextNode = currentNode.children.find((c) => c.name === dataPath.key)
    if (!nextNode) return undefined

    // Рекурсивно идём дальше, если есть value
    if (dataPath.value) {
      return this.findNodeByDataPath(dataPath.value, nextNode)
    }

    return nextNode
  }

  override getDependencyComponentIds(): Array<string | number> {
    const componentIds: Array<string | number> = []

    this.columns.forEach((column) => {
      if (RComponentTableColumn_isComponent(column) && column.componentId) {
        componentIds.push(column.componentId)
      }
    })
    return componentIds
  }

  //
  // GET/SET
  //
  get rowSizeCalc(): string | number | 'zoom' {
    return Endge.vars.resolve(this.rowSize) || 40
  }
}
