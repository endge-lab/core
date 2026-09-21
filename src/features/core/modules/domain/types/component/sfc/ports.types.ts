import type { RComponentSFC_IR_Value } from './ir.types'

import type { RComponentSFC_SourceRange } from './location.types'
import type { RComponentContractInput } from '@/features/core/modules/domain/types/component/component-core.types'

export type ComponentSFCPortRole = 'require' | 'provides' | 'emits'
export type ComponentSFCPortKind = 'computation' | 'component' | 'action' | 'query' | 'event'
export type ComponentSFCRequiredPortKind = Exclude<ComponentSFCPortKind, 'event'>

/** Публичный дочерний порт, выбранный правилом `definePorts.forward` при компиляции. */
export interface ComponentSFCPortForwardOrigin {
  nodeId: string
  ref?: string
  componentIdentity?: string
  componentTag: string
  portName: string
}

/** Нормализованный селектор одного направления порта внутри правила forward. */
export interface ComponentSFCPortForwardSelector {
  include: '*' | string[]
  exclude: string[]
  rename: Record<string, string>
  namespace?: 'none' | 'ref' | string
}

/** Правило перенаправления времени компиляции, сохранённое в артефакте Component SFC. */
export interface ComponentSFCPortForwardRule {
  from: '*' | string[]
  ports: Partial<Record<ComponentSFCPortRole, ComponentSFCPortForwardSelector>>
  namespace: 'none' | 'ref' | string
  sourceRange?: RComponentSFC_SourceRange
}

/** Описатель провайдера по умолчанию, предоставляемый границей сборки домена. */
export type ComponentSFCPortProviderDescriptor
  = | {
    kind: 'computation'
    identity: string
    active: boolean
    input: { type: string, isArray?: boolean, optional?: boolean } | null
    output: { type: string, isArray?: boolean, optional?: boolean } | null
  }
  | {
    kind: 'component'
    identity: string
    active: boolean
    inputs: RComponentContractInput[]
  }
  | {
    kind: 'action'
    identity: string
    active: boolean
    input: { type: string, isArray?: boolean, optional?: boolean } | null
    output: { type: string, isArray?: boolean, optional?: boolean } | null
  }
  | {
    kind: 'query'
    identity: string
    active: boolean
    inputs: RComponentContractInput[]
    outputs: RComponentContractInput[]
  }

/** Порт Computation, объявленный через `computation<Input, Output>`. */
export interface ComponentSFCComputationPort {
  kind: 'computation'
  name: string
  defaultIdentity: string
  inputType: string
  outputType: string
  forwardedFrom?: ComponentSFCPortForwardOrigin
  sourceRange?: RComponentSFC_SourceRange
}

/** Порт Component, объявленный через `component<Props>`. */
export interface ComponentSFCComponentPort {
  kind: 'component'
  name: string
  tag: string
  defaultIdentity: string
  propsType: string
  inputs: RComponentContractInput[]
  forwardedFrom?: ComponentSFCPortForwardOrigin
  sourceRange?: RComponentSFC_SourceRange
}

/** Вызываемый Action, требуемый извне или предоставляемый этим компонентом. */
export interface ComponentSFCActionPort {
  kind: 'action'
  role: 'require' | 'provides'
  name: string
  inputType: string
  outputType: string
  defaultIdentity?: string
  forwardedFrom?: ComponentSFCPortForwardOrigin
  sourceRange?: RComponentSFC_SourceRange
}

/** Вызываемый Query, требуемый компонентом. */
export interface ComponentSFCQueryPort {
  kind: 'query'
  name: string
  defaultIdentity: string
  inputType: string
  outputType: string
  inputs: RComponentContractInput[]
  outputs: RComponentContractInput[]
  forwardedFrom?: ComponentSFCPortForwardOrigin
  sourceRange?: RComponentSFC_SourceRange
}

/** Одно статическое переопределение провайдера для вызова смонтированного дочернего Component SFC. */
export interface ComponentSFCRequiredPortBinding {
  port: string
  kind: ComponentSFCRequiredPortKind
  identity: string
  sourceRange?: RComponentSFC_SourceRange
}

/** Многоадресное уведомление, создаваемое этим компонентом. */
export interface ComponentSFCEventPort {
  kind: 'event'
  role: 'emits'
  name: string
  /** Читаемая человеком метка каталога. Идентичность по-прежнему основана на `name`. */
  displayName?: string
  payloadType: string
  /** Необязательный локальный producer, Event которого повторно публикует этот компонент. */
  from?: ComponentSFCEventSource
  /** Необязательная реакция, выполняемая после публикации возникновения Event. */
  action?: ComponentSFCEventAction
  forwardedFrom?: ComponentSFCPortForwardOrigin
  sourceRange?: RComponentSFC_SourceRange
}

/** Литеральная ссылка на дочерний Event для `event({ from })`. */
export interface ComponentSFCEventSource {
  ref: string
  event: string
}

/** Безопасное нейтральное к renderer выражение, сопоставленное со входом реакции Event. */
export type ComponentSFCEventInputValue
  = | { kind: 'event', path: string | null }
    | { kind: 'operation-input', path: string | null }
    | { kind: 'now' }
    | { kind: 'scope', path: string }
    | { kind: 'literal', value: unknown }
    | { kind: 'coalesce', left: ComponentSFCEventInputValue, right: ComponentSFCEventInputValue }
    | { kind: 'array', items: ComponentSFCEventInputValue[] }
    | { kind: 'object', entries: ComponentSFCEventInputEntry[] }

export interface ComponentSFCEventInputEntry {
  key: string | ComponentSFCEventInputValue
  value: ComponentSFCEventInputValue
}

/** Один Action, выбранный непосредственно в Source Component SFC. */
export interface ComponentSFCEventDirectAction {
  kind: 'action'
  identity: string
  input?: ComponentSFCEventInputValue
}

/** Один Query, выбранный непосредственно в Source Component SFC. */
export interface ComponentSFCEventDirectQuery {
  kind: 'query'
  identity: string
  input?: ComponentSFCEventInputValue
}

/** Изолированная реакция TypeScript. Её результатом является проверенный список эффектов. */
export interface ComponentSFCEventTypescriptAction {
  kind: 'typescript'
  inputs: Record<string, { kind: 'event', path: string | null }>
  /** Исходное выражение `typescript({...})` для двусторонней проекции Source и редактора. */
  definitionSource?: string
  source: string
  emittedEvents: string[]
}

/** Безопасный локальный emit из template reaction. */
export interface ComponentSFCEventEmitAction {
  kind: 'emit'
  event: string
  payload?: ComponentSFCEventInputValue
}

export interface ComponentSFCEventOperationBlockStep {
  name: string
  action: ComponentSFCEventAction
}

export interface ComponentSFCEventOperationBlock {
  steps: ComponentSFCEventOperationBlockStep[]
  output: string | null
}

/** Inline-алгоритм с отменой, скомпилированный из одной реакции Component SFC. */
export interface ComponentSFCEventOperationAction {
  kind: 'operation'
  input?: ComponentSFCEventInputValue
  run: ComponentSFCEventOperationBlock
  undo: ComponentSFCEventOperationBlock
  redo: ComponentSFCEventOperationBlock | null
}

/** Вызывает один обязательный исполняемый порт через фактический провайдер экземпляра. */
export interface ComponentSFCEventRequiredPortAction {
  kind: 'required-port'
  portKind: 'action' | 'query'
  port: string
  input?: ComponentSFCEventInputValue
}

export type ComponentSFCEventAction
  = ComponentSFCEventDirectAction
    | ComponentSFCEventDirectQuery
    | ComponentSFCEventOperationAction
    | ComponentSFCEventTypescriptAction
    | ComponentSFCEventEmitAction
    | ComponentSFCEventRequiredPortAction

export interface ComponentSFCEventRuntimeSource {
  nodeId: string
  ref?: string
  componentIdentity?: string
  componentTag: string
  target?: {
    type: string
    identity: string
    value: unknown
  }
}

export interface ComponentSFCEventOccurrence<TPayload = unknown> {
  componentIdentity: string
  event: string
  payload: TPayload
  source?: ComponentSFCEventRuntimeSource
}

export interface ComponentSFCRequiredPorts {
  computations: ComponentSFCComputationPort[]
  components: ComponentSFCComponentPort[]
  actions: ComponentSFCActionPort[]
  queries: ComponentSFCQueryPort[]
}

export interface ComponentSFCProvidedPorts {
  actions: ComponentSFCActionPort[]
}

export interface ComponentSFCEmittedPorts {
  events: ComponentSFCEventPort[]
}

/** Типизированный манифест портов в скомпилированном артефакте ComponentSFC. */
export interface ComponentSFCPortManifest {
  require: ComponentSFCRequiredPorts
  provides: ComponentSFCProvidedPorts
  emits: ComponentSFCEmittedPorts
  forward: {
    rules: ComponentSFCPortForwardRule[]
  }
}

/** Одно локальное значение верхнего уровня, инициализированное вызовом порта computation. */
export interface RComponentSFC_IR_PortCall {
  kind: 'computation'
  local: string
  port: string
  defaultIdentity: string
  input: RComponentSFC_IR_Value
  sourceRange?: RComponentSFC_SourceRange
}

/** Маркер вложенного узла Component IR, созданного из локального порта компонента. */
export interface RComponentSFC_IR_ComponentPortMarker {
  kind: 'component'
  port: string
  defaultIdentity: string
}

export function createEmptyComponentSFCPortManifest(): ComponentSFCPortManifest {
  return {
    require: {
      computations: [],
      components: [],
      actions: [],
      queries: [],
    },
    provides: {
      actions: [],
    },
    emits: {
      events: [],
    },
    forward: {
      rules: [],
    },
  }
}
