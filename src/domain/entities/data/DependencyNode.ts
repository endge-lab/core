import type { RField } from '@/domain/entities/reflect/RField'
import type { DataPath } from '@endge/raph'
import { Endge } from '@/model/endge/endge'

/**
 * Узел зависимости
 */
export class DependencyNode {
  // Имя field узла
  name: string = 'root'

  // Вычисляемый тип на этапе сборки
  type: string = 'none'

  // Все потомки
  children: DependencyNode[] = []

  // Маркеры
  markers: Set<string> = new Set()

  // Параметры (например, при поиске элементов в массиве)
  params: Map<string, Set<any>> = new Map()

  /**
   * Добавляет дочерний узел в дерево.
   * Если такой уже есть (по name и type), мержит их детей и параметры.
   */
  addChild(newChild: DependencyNode): void {
    const existingChild = this.children.find(
      (c) => c.name === newChild.name && c.type === newChild.type,
    )

    if (!existingChild) {
      this.children.push(newChild)
      return
    }

    // Мержим параметры
    newChild.params.forEach((values, key) => {
      if (!existingChild.params.has(key)) {
        existingChild.params.set(key, new Set(values))
      } else {
        const existingSet = existingChild.params.get(key)!
        values.forEach((v) => existingSet.add(v))
      }
    })

    // Рекурсивно мержим детей
    newChild.children.forEach((child) => {
      existingChild.addChild(child)
    })
  }

  /**
   * Создаёт новый DependencyNode из RField.
   */
  static fromRField(field: RField): DependencyNode {
    const node = new DependencyNode()
    node.name = field.name
    node.type = field.type
    return node
  }

  /**
   * Создаёт дерево DependencyNode по dataPath.
   * Обрабатывает параметры (params) и сохраняет их в виде множества.
   */
  static fromDataPath(
    dataPath: DataPath,
    baseType: string,
    parentNode?: DependencyNode,
  ): DependencyNode {
    // Пропускаем '$'
    if (!dataPath.key || dataPath.key === '$') {
      if (dataPath.value) {
        return DependencyNode.fromDataPath(dataPath.value, baseType, parentNode)
      }
      return parentNode || new DependencyNode()
    }

    // Если key === '*' - это фильтр внутри массива (не создаём новую ноду!)
    if (dataPath.key === '*') {
      // Добавляем параметры в родителя
      if (dataPath.params && parentNode) {
        dataPath.params.forEach((value, key) => {
          if (!parentNode.params.has(key)) {
            parentNode.params.set(key, new Set([value]))
          } else {
            parentNode.params.get(key)!.add(value)
          }
        })
      }

      // Продолжаем разбор с дочерним dataPath
      if (dataPath.value) {
        return DependencyNode.fromDataPath(dataPath.value, baseType, parentNode)
      }

      // Возвращаем родителя (ничего нового не создаём)
      return parentNode!
    }

    // Для обычных ключей - создаём новую ноду
    const node = new DependencyNode()
    node.name = dataPath.key.toString()

    // Добавляем параметры, если есть
    if (dataPath.params) {
      dataPath.params.forEach((value, key) => {
        node.params.set(key, new Set([value]))
      })
    }

    // Определяем тип
    const typeDef = Endge.domain.getType(baseType)
    if (typeDef) {
      const field = typeDef.fields.get(dataPath.key)
      if (field) {
        node.type = field.type
        // Рекурсивно разбираем value
        if (dataPath.value) {
          const childNode = DependencyNode.fromDataPath(
            dataPath.value,
            field.type,
            node,
          )
          node.children.push(childNode)
        }
        return node
      }
    }

    // Если тип не найден, идём дальше с тем же типом
    if (dataPath.value) {
      const childNode = DependencyNode.fromDataPath(
        dataPath.value,
        baseType,
        node,
      )
      node.children.push(childNode)
    }

    return node
  }

  /**
   * Помечает все узлы, которые соответствуют GraphQL-ответу.
   */
  markTouchedPaths(currentType: string, marker: string): void {
    const typeDef = Endge.domain.getType(currentType)
    if (!typeDef) return

    for (const child of this.children) {
      const field = typeDef.fields.get(child.name)
      if (!field) continue

      child.markers.add(marker)
      child.markTouchedPaths(field.type, marker)
    }
  }
}
