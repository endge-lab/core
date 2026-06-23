import type { DependencyNode } from '@/domain/entities/data/DependencyNode'

/**
 * Представляет связь (ребро) в графе зависимостей между родительским компонентом
 * и дочерним компонентом (или между двумя узлами одного компонента).
 *
 * Эта структура позволяет отследить, как данные из одного узла (переменной, поля)
 * передаются или используются другим узлом (например, входом подкомпонента).
 *
 * @example
 * // Пример 1: Прямая передача переменной из родителя в дочерний компонент
 * const edge: DependencyEdge = {
 *   from: parentVarNode,          // узел переменной "var1" в родителе
 *   to: childVarNode,             // узел переменной "var_inner" в подкомпоненте
 *   path: new DataPath('$'),      // эквивалентная передача без изменений
 * }
 *
 * @example
 * // Пример 2: Передача вложенного значения из объекта
 * const edge: DependencyEdge = {
 *   from: parentVarNode,          // родительский узел "user"
 *   to: childVarNode,             // подкомпонентный узел "city"
 *   path: new DataPath('address.city'), // путь до вложенного свойства
 * }
 *
 * @example
 * // Пример 3: Передача с переименованием (aliasMap может помочь явно указать соответствие)
 * const edge: DependencyEdge = {
 *   from: parentVarNode,
 *   to: childVarNode,
 *   path: new DataPath('$'),
 * }
 */
export interface DependencyEdge {
  /**
   *  Информационное имя связи для отладки
   */
  name?: string

  /**
   * Узел-источник (родительский узел или переменная),
   * из которого берутся данные для передачи.
   */
  from: DependencyNode

  /**
   * Узел-приемник (дочерний узел или вход подкомпонента),
   * который будет использовать переданные данные.
   */
  to: DependencyNode
}
