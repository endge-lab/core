import { EventBus } from '@endge/utils'

export enum RuntimeEventType {
  Mounted = 'component:mount',
}

export interface RuntimeEvents {
  [RuntimeEventType.Mounted]: { componentId: string; storeKey?: string }
}

/**
 * Описывает контекст среды исполнения для некоторого сегмента.
 * Сегментом может быть setup-скрипт сценария, компонента или другие runtime-скрипты, JSX контексты.
 * Каждый сегмент связан с предыдущим - родительским (вложенность любая).
 */
export class RuntimeScope extends EventBus<RuntimeEvents> {
  readonly id: string
  readonly parent?: RuntimeScope

  // Словарь переменных, извлечённых из comData по varsPaths.
  // Заполняется на этапе runtime исполнения JSX.
  // В setup скрипте он пустой и не требуется.
  public readonly vars: Map<string, any> = new Map()

  public readonly ui: {
    // mount: пользователь монтирует компонент с данными из хранилища
    componentMountedId?: string
    componentMountedStoreId?: string
  } = {}

  // Здесь будут все экспортируемые функции после запуска setup-скрипта
  public readonly export: {
    // expose: автоматически экспортируемые функции
    names?: Record<string, CallableFunction>
  } = {}

  constructor(id: string, parent?: RuntimeScope) {
    super()
    this.id = id
    this.parent = parent
  }

  /**
   * Рекурсивный поиск экспортируемого имени
   * ToDo: рекурсия? потомку доступны родительские методы?
   */
  findExportedFn(name: string): CallableFunction | undefined {
    return this.export.names?.[name] ?? this.parent?.findExportedFn(name)
  }

  /**
   * Получить значение переменной, пробрасываясь по родителям
   */
  getVar(name: string): any {
    if (this.vars.has(name)) {
      return this.vars.get(name)
    }
    return this.parent?.getVar(name)
  }

  /**
   * Массовая установка переменных
   */
  setVars(vars: Record<string, any> | Map<string, any>): void {
    if (vars instanceof Map) {
      vars.forEach((value, key) => this.vars.set(key, value))
    } else {
      Object.entries(vars).forEach(([key, value]) => this.vars.set(key, value))
    }
  }

  /**
   * Проверка наличия переменной (с учётом родителя)
   */
  hasVar(name: string): boolean {
    return this.vars.has(name) || this.parent?.hasVar(name) || false
  }
}
