/** Цель рендера, под которую компонент может быть скомпилирован. */
export type RComponentRenderTarget = 'dom' | 'canvas'

/** Источник описания компонента в новой ветке модели. */
export type RComponentSourceKind = 'component-sfc'

/** Уровень диагностического сообщения компилятора компонента. */
export type RComponentDiagnosticSeverity = 'info' | 'warning' | 'error'

/** Ссылка на компонент из чистого SFC-хранилища новой версии. */
export interface RComponentRef {
  /** Тип хранилища, в котором лежит новый компонент. */
  source: 'component-sfc'

  /** Идентификатор компонента внутри выбранного хранилища. */
  id: string | number
}

/** Описание одного сообщения компилятора или валидатора. */
export interface RComponentDiagnostic {
  /** Уровень важности сообщения. */
  severity: RComponentDiagnosticSeverity

  /** Машинный код ошибки или предупреждения. */
  code: string

  /** Человекочитаемое описание проблемы. */
  message: string

  /** Опциональный путь до секции source: script/template/style. */
  sourcePath?: string

  /** Начальная позиция в source, если она известна компилятору. */
  start?: number

  /** Конечная позиция в source, если она известна компилятору. */
  end?: number
}

/** Контракт входных данных компонента. */
export interface RComponentContractInput {
  /** Имя входного параметра, доступное в template/script. */
  name: string

  /** Тип входного параметра в доменной модели. */
  type: string

  /** Флаг массива для простого отображения в UI конфигуратора. */
  isArray?: boolean

  /** Флаг необязательного параметра. */
  optional?: boolean
}

/** Контракт события, которое компонент может отправить наружу. */
export interface RComponentContractEvent {
  /** Имя события в template: @name="handler". */
  name: string

  /** Описание полезной нагрузки события. */
  payloadType?: string
}

/** Контракт slot, который компонент разрешает переопределять. */
export interface RComponentContractSlot {
  /** Имя slot, default используется для содержимого без имени. */
  name: string

  /** Имена параметров, которые slot получает в scope. */
  scope?: string[]
}

/** Контракт компонента, извлеченный из source. */
export interface RComponentContract {
  /** Входные данные компонента. */
  inputs: RComponentContractInput[]

  /** События, которые компонент может emit-ить. */
  events: RComponentContractEvent[]

  /** Slot-ы, которые компонент предоставляет. */
  slots: RComponentContractSlot[]
}

/** Набор внешних зависимостей, найденных при компиляции компонента. */
export interface RComponentDependencies {
  /** Дочерние компоненты, на которые ссылается template. */
  components: RComponentRef[]

  /** Действия, которые вызываются из handlers или bindings. */
  actions: string[]

  /** Источники данных, которые компонент читает напрямую. */
  dataSources: string[]

  /** Внешние render/capability ссылки. */
  renderers: string[]
}

/** Пустой контракт нужен, чтобы compile всегда возвращал предсказуемую форму. */
export function createEmptyComponentContract(): RComponentContract {
  return {
    inputs: [],
    events: [],
    slots: [],
  }
}

/** Пустой набор зависимостей используется перед каждым новым проходом compile. */
export function createEmptyComponentDependencies(): RComponentDependencies {
  return {
    components: [],
    actions: [],
    dataSources: [],
    renderers: [],
  }
}
