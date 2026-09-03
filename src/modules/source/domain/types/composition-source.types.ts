import type { ComponentSFCInteractionTrigger } from '@/modules/domain/types/component/sfc/ir.types'
import type { ComponentSFCEventInputValue } from '@/modules/domain/types/component/sfc/ports.types'
import type { I18nCompiledLocales } from '@/modules/i18n/domain/i18n.types'
import type { EndgeMockReference } from '@/modules/mock/domain/types/mock-data.type'
import type { ProgramMetadataMap } from '@/modules/program/domain/types/program-metadata.types'
import type { ProgramDiagnostic } from '@/modules/program/domain/types/program.types'
import type { RuntimeHost } from '@/modules/runtime/domain/runtime-host.types'
import type { RuntimeScopeHandle } from '@/modules/runtime/domain/runtime-scope.types'
import type { VocabLoadPolicy } from '@/modules/runtime/domain/vocab-cache.types'
import type { FilterViewControlDefinition } from '@/modules/source/domain/types/filter-view.type'
import type { SourceExpressionIR, SourceFieldDefinition } from '@/modules/source/domain/types/source-expression.types'
import type { UpdateMutationStrategy } from '@/modules/source/domain/types/update-source.types'
import type { EndgeDataMode } from '@/modules/workspace/domain/workspace.types'

export type CompositionRuntimeKind = 'filter' | 'query' | 'component' | 'composition' | 'stream' | 'filter-view'

export type CompositionActivationMode = 'startup' | 'manual'

export interface CompositionActivationDescriptor {
  mode: CompositionActivationMode
}

interface CompositionResourceDescriptorBase {
  name: string
  path: string
  scopePath: string
  sourceOrder: number
}

type CompositionSourceAssetResourceDescriptor = CompositionResourceDescriptorBase & {
  kind: 'style' | 'i18n'
  identity: string
}

type CompositionOperationHistoryResourceDescriptor = CompositionResourceDescriptorBase & {
  kind: 'operation-history'
  operationHistory: {
    limit: number
    limitConfigurationPath: string | null
    shortcuts: OperationHistoryShortcutDescriptor[] | null
  }
}

export type CompositionResourceDescriptor = CompositionSourceAssetResourceDescriptor | CompositionOperationHistoryResourceDescriptor

export interface OperationHistoryShortcutDescriptor {
  command: 'undo' | 'redo'
  triggerSet:
    | { kind: 'configuration', path: string }
    | { kind: 'literal', value: ComponentSFCInteractionTrigger[] }
}

/** Материализованный i18n-resource внутри Composition program artifact. */
export interface CompositionI18nResourceArtifact {
  name: string
  path: string
  scopePath: string
  identity: string
  sourceOrder: number
  messages: I18nCompiledLocales
}

export interface CompositionScopeDescriptor {
  name: string
  /** Публичный path; implicit scope_default имеет path "scope_default". */
  path: string
  parentPath: string | null
  activationOverride: CompositionActivationDescriptor | null
  effectiveActivation: CompositionActivationDescriptor
  /** Data dependencies, активируемые вместе с lifecycle scope. */
  data?: string[]
  resources: string[]
  runtimes: string[]
  children: string[]
  sourceOrder: number
}

export type CompositionBindingValue
  = | { kind: 'literal', value: unknown }
    | { kind: 'output', runtime: string, output: string }
    | { kind: 'outputs', runtime: string, outputs?: string[] }
    | { kind: 'store', key: string }
    | { kind: 'data', data: string, path: string }
    | { kind: 'runtime-metadata', runtime: string, namespace?: string }
    | { kind: 'filter-fields', runtime: string, fields: string[] }
    | {
      kind: 'data-view'
      data: string
      path: string
      identity: string
      props: Record<string, CompositionBindingValue>
    }
    | { kind: 'expression', expression: SourceExpressionIR }

export interface CompositionDataDescriptor {
  name: string
  /** Полный data path. Для root data совпадает с name. */
  path?: string
  /** Lifecycle scope, которому принадлежит dependency. */
  scopePath?: string
  kind: 'store' | 'vocab'
  identity: string
  /** Политика разрешения Store; для Vocab не используется. */
  resolution?: 'contextual' | 'isolated' | 'injected'
  /** Provider slot для нескольких Store instances с одной identity. */
  slot?: string | null
  /** Нормализованная политика загрузки Vocab; для Store не используется. */
  policy?: VocabLoadPolicy
}

export interface CompositionStorePublication {
  data: string
  fields: Record<string, string>
}

export interface CompositionFilterFieldsSlice {
  kind: 'filter-fields'
  runtimeId: string
  runtimeName: string
  fieldKeys: string[]
  fields: SourceFieldDefinition[]
  values: Record<string, unknown>
}

export interface CompositionRuntimeDescriptor {
  name: string
  /** Полный публичный path runtime внутри Composition. */
  path: string
  /** Internal path owning RuntimeScope. */
  scopePath: string
  /** Source offsets used by authoring tools; runtime does not interpret them. */
  sourceLocations?: {
    runtime: { start: number, end: number }
    call: { start: number, end: number }
    withProps: { start: number, end: number } | null
  }
  kind: CompositionRuntimeKind
  identity: string
  /** Явный override в месте вызова runtime. */
  activationOverride: CompositionActivationDescriptor | null
  /** Compiler-linked activation, которую runtime применяет без интерпретации source. */
  effectiveActivation: CompositionActivationDescriptor
  fields?: string[]
  controls?: Record<string, FilterViewControlDefinition>
  componentIdentity?: string
  persistKey?: string
  props: Record<string, CompositionBindingValue>
  /** Локальный data alias child -> data alias owner Composition. */
  dataBindings?: Record<string, string>
  storeTo: CompositionStorePublication[]
  /** Store data aliases receiving normalized Stream events. */
  dispatchTo?: string[]
  /** Optional Composition-owned event batching policy. */
  batch?: {
    maxItems: number
    maxWaitMs: number
  }
}

export interface CompositionRuntimeChildHandle {
  name: string
  descriptor: CompositionRuntimeDescriptor
  runtime: RuntimeHost<any, any>
}

/** Источник изменения для управляемого повторного запуска Query. */
export type CompositionChangeSource
  = | { kind: 'runtime-output', runtime: string, output: string }
    | { kind: 'prop', path: string }

export type CompositionHook
  = | { kind: 'mount', target: string }
    | { kind: 'change', source: CompositionChangeSource, target: string, debounceMs: number }
    | { kind: 'success', runtime: string, target: string }
    | CompositionComponentEventHook

export interface ComponentEventApplyUpdateEffect {
  kind: 'apply-update'
  data: string
  update: string
  input?: ComponentSFCEventInputValue
}

export interface ComponentEventStoreMutationEffect {
  kind: 'mutate-store'
  data: string
  mutation: {
    strategy: UpdateMutationStrategy
    path: string
    value?: ComponentSFCEventInputValue
    vars?: Record<string, ComponentSFCEventInputValue>
  }
}

export interface ComponentEventExecuteActionEffect {
  kind: 'execute-action'
  action: string
  input?: ComponentSFCEventInputValue
}

export type CompositionComponentEventEffect
  = ComponentEventApplyUpdateEffect
    | ComponentEventStoreMutationEffect
    | ComponentEventExecuteActionEffect

export interface CompositionComponentEventHook {
  kind: 'event'
  runtime: string
  event: string
  effect: CompositionComponentEventEffect
}

export interface CompositionRuntimeOutputDescriptor {
  key: string
  kind: 'runtime'
  runtime: string
  output?: string
}

export interface CompositionScopeOutputDescriptor {
  key: string
  kind: 'scope'
  scope: string
}

export type CompositionOutputDescriptor
  = | CompositionRuntimeOutputDescriptor
    | CompositionScopeOutputDescriptor

export type CompositionPreviewLiteral
  = | null
    | string
    | number
    | boolean
    | CompositionPreviewLiteral[]
    | { [key: string]: CompositionPreviewLiteral }

export type CompositionPreviewPropValue
  = | { kind: 'literal', value: CompositionPreviewLiteral }
    | EndgeMockReference

export type CompositionPreviewProps = Record<string, CompositionPreviewPropValue>

export interface CompositionSourceDocument {
  /** Локальный override режима данных; отсутствие значения наследует runtime ancestry. */
  dataMode?: EndgeDataMode | null
  activation: CompositionActivationDescriptor | null
  /** Публичный props contract Composition. */
  props: SourceFieldDefinition[]
  /** Preview-only fixtures. Не являются runtime defaults. */
  previewProps?: CompositionPreviewProps | null
  data: CompositionDataDescriptor[]
  resources: CompositionResourceDescriptor[]
  scopes: CompositionScopeDescriptor[]
  runtimes: CompositionRuntimeDescriptor[]
  hooks: CompositionHook[]
  outputs: CompositionOutputDescriptor[]
}

/** Добавление data dependency в canonical Composition source. */
export interface CompositionSourceAddDataPatch {
  type: 'add-data'
  name: string
  kind: CompositionDataDescriptor['kind']
  identity: string
}

/** Добавление owned resource в canonical Composition source. */
export interface CompositionSourceAddResourcePatch {
  type: 'add-resource'
  name: string
  kind: CompositionResourceDescriptor['kind']
  identity?: string
}

/** Добавление runtime dependency в canonical Composition source. */
export interface CompositionSourceAddRuntimePatch {
  type: 'add-runtime'
  name: string
  kind: Exclude<CompositionRuntimeKind, 'filter-view'>
  identity: string
  activation?: CompositionActivationMode
}

/** Одна узкая source-preserving операция над Composition dependencies. */
export type CompositionSourcePatchOperation
  = | CompositionSourceAddDataPatch
    | CompositionSourceAddResourcePatch
    | CompositionSourceAddRuntimePatch

/** Composition source patch: одиночная операция или атомарная пачка. */
export type CompositionSourcePatch
  = | CompositionSourcePatchOperation
    | CompositionSourcePatchOperation[]

/** Нормализованная связь input runtime-ноды. */
export interface CompositionRuntimeInputConnection {
  targetRuntime: string
  targetProp: string
  source: CompositionBindingValue
}

/** Явная передача Store data из owner Composition во вложенную Composition. */
export interface CompositionRuntimeDataConnection {
  targetRuntime: string
  targetData: string
  sourceData: string
}

/** Нормализованный trigger логического update runtime-ноды. */
export interface CompositionRuntimeUpdateConnection {
  id: string
  source: CompositionChangeSource
  targetRuntime: string
  updateKind: 'run'
  debounceMs: number
}

/** Запуск target Query после успешного выполнения source Query. */
export interface CompositionRuntimeSuccessConnection {
  id: string
  sourceRuntime: string
  targetRuntime: string
  updateKind: 'run'
}

/** Публикация output runtime-ноды в Composition data. */
export interface CompositionRuntimePublicationConnection {
  id: string
  sourceRuntime: string
  sourceOutput: string
  targetData: string
  targetPath: string
}

/** Действие, выполняемое после mount всего графа. */
export interface CompositionRuntimeMountConnection {
  targetRuntime: string
  updateKind: 'run'
}

export interface CompositionRuntimeEventConnection extends CompositionComponentEventHook {
  id: string
}

/** Исполняемый граф Composition, построенный компилятором из source document. */
export interface CompositionRuntimeGraph {
  inputs: CompositionRuntimeInputConnection[]
  dataInputs?: CompositionRuntimeDataConnection[]
  updates: CompositionRuntimeUpdateConnection[]
  /** Optional для чтения artifacts, скомпилированных до появления onSuccess. */
  successes?: CompositionRuntimeSuccessConnection[]
  publications: CompositionRuntimePublicationConnection[]
  mounts: CompositionRuntimeMountConnection[]
  /** Component semantic Event effects owned by this Composition. */
  events?: CompositionRuntimeEventConnection[]
}

/** Payload Composition artifact без runtime state. */
export interface CompositionProgramPayload extends CompositionSourceDocument {
  type: 'composition'
  sourceVersion: number
  /** Снимки словарей, которые runtime читает без обращения к Domain. */
  i18nResources?: CompositionI18nResourceArtifact[]
  graph: CompositionRuntimeGraph
}

export interface CompositionSourceCompileResult {
  ast: unknown | null
  document: CompositionSourceDocument | null
  artifact: CompositionProgramPayload | null
  metadata: ProgramMetadataMap
  diagnostics: Omit<ProgramDiagnostic, 'entityRef'>[]
}

export interface CompositionRuntimeOutputHandle {
  kind: 'runtime'
  runtime: RuntimeHost<any, any> | null
  output?: string
}

/** Публичный контракт Composition host без зависимости Domain от concrete Model runtime. */
export interface CompositionRuntimeHostHandle extends RuntimeHost<'composition', any, CompositionProgramPayload> {
  mountGraph: () => Promise<void>
  getChild: (name: string) => RuntimeHost<any, any> | null
  getChildren: () => CompositionRuntimeChildHandle[]
  getFilterFieldsSlice: (runtimeName: string, fieldKeys: string[]) => CompositionFilterFieldsSlice | null
  getOutputs: () => Readonly<Record<string, CompositionPublicOutputHandle>>
  getScope: (path: string) => RuntimeScopeHandle | null
  getRuntimeHandle: (path: string) => CompositionRuntimeActivationHandle | null
  getOutput: (name: string) => unknown
  getDataSnapshot: () => Readonly<Record<string, unknown>>
  getProps: () => Readonly<Record<string, unknown>>
  getDataPath: (name: string, path?: string) => string
}

export interface CompositionRuntimeActivationHandle {
  readonly path: string
  readonly state: 'inactive' | 'active' | 'paused' | 'disposed'
  readonly runtime: RuntimeHost<any, any> | null
  activate: () => Promise<RuntimeHost<any, any>>
  pause: () => Promise<void>
  resume: () => Promise<void>
  deactivate: () => Promise<void>
  dispose: () => Promise<void>
  getOutput: (name: string) => unknown
}

export type CompositionPublicOutputHandle
  = | CompositionRuntimeOutputHandle
    | CompositionRuntimeActivationHandle
    | RuntimeScopeHandle

export interface CompositionMountOptions {
  id?: string
  /** Значения публичных Composition props для standalone mount. */
  props?: Record<string, unknown>
  /** Явные runtime-id Store instances для data aliases. */
  dataRuntimes?: Record<string, string>
}

export interface CompositionSession<THost extends CompositionRuntimeHostHandle = CompositionRuntimeHostHandle> {
  id: string
  host: THost
  outputs: Readonly<Record<string, CompositionPublicOutputHandle>>
  output: <T = unknown>(name: string) => T | undefined
  unmount: () => Promise<void>
}
