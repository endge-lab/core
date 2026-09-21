import type { EndgeModule } from '@/features/federation/EndgeModule'
import type {
  AnyEndgeModule,
  EndgeModuleDefinitions,
  EndgeModuleDescriptor,
  EndgeModuleOrder,
} from '@/features/federation/types/endge-modules.types'

/** Минимальный context, общий для lifecycle любой федерации. */
export interface EndgeFederationContext {
  signal?: AbortSignal
}

export type EndgeFederationState = 'idle' | 'booting' | 'ready' | 'building' | 'resetting' | 'failed'

export type EndgeModuleDiagnosticsSnapshotStatus = 'captured' | 'empty' | 'skipped' | 'failed' | 'referenced'

/** Стабильная ссылка на Module внутри декларативного дерева Federation. */
export interface EndgeModuleDiagnosticsSnapshotReference {
  federationId: string
  key: string
  path: string[]
  moduleName: string
}

/** Настройки рекурсивного сбора диагностического дерева Federation. */
export interface EndgeFederationDiagnosticsSnapshotOptions {
  shouldCaptureModule?: (module: EndgeModuleDiagnosticsSnapshotReference) => boolean
}

/** Диагностический узел зарегистрированного Module. */
export interface EndgeModuleDiagnosticsSnapshotNode extends EndgeModuleDiagnosticsSnapshotReference {
  kind: 'module'
  status: EndgeModuleDiagnosticsSnapshotStatus
  snapshot?: unknown
  snapshotRef?: string
  error?: string
}

/** Диагностический узел дочерней Federation. */
export interface EndgeChildFederationDiagnosticsSnapshotNode {
  kind: 'federation'
  key: string
  path: string[]
  status: 'captured' | 'failed'
  federation?: EndgeFederationDiagnosticsSnapshot
  error?: string
}

export type EndgeFederationDiagnosticsSnapshotNode
  = EndgeModuleDiagnosticsSnapshotNode
    | EndgeChildFederationDiagnosticsSnapshotNode

/** Рекурсивная диагностическая проекция одного декларативного Federation graph. */
export interface EndgeFederationDiagnosticsSnapshot {
  id: string
  name: string
  path: string[]
  state: EndgeFederationState
  plugins: string[]
  nodes: EndgeFederationDiagnosticsSnapshotNode[]
}

/** Публичный lifecycle-контракт статического facade Federation. */
export interface EndgeFederationFacade<in TContext extends EndgeFederationContext = EndgeFederationContext> {
  readonly id: string
  readonly isConfigured: boolean
  readonly isInitialized: boolean
  readonly lastError: unknown | null
  readonly state: EndgeFederationState
  createDiagnosticsSnapshot: (options?: EndgeFederationDiagnosticsSnapshotOptions) => EndgeFederationDiagnosticsSnapshot
  boot: (ctx: TContext) => Promise<void>
  build: (ctx?: TContext) => Promise<void>
  reset: () => Promise<void>
}

export type AnyEndgeFederation = EndgeFederationFacade<any>

/** Дочерняя Federation как один composite lifecycle-узел родительского graph. */
export interface EndgeChildFederationDefinition<
  TKey extends string = string,
  TFederation extends AnyEndgeFederation = AnyEndgeFederation,
> {
  readonly key: TKey
  readonly federation: TFederation
  readonly before?: EndgeModuleOrder
  readonly after?: EndgeModuleOrder
}

export type EndgeChildFederationDefinitions = readonly EndgeChildFederationDefinition[]

/** Plugin декларативно расширяет одну Federation до её configuration/boot. */
export interface EndgePlugin<
  TModules extends EndgeModuleDefinitions = EndgeModuleDefinitions,
  TFederations extends EndgeChildFederationDefinitions = EndgeChildFederationDefinitions,
> {
  readonly id: string
  readonly modules?: TModules
  readonly federations?: TFederations
  /** Selects an ordered subset once per boot; reset uses the same nodes. */
  readonly selectLifecycleNodes?: (nodes: readonly EndgeLifecycleNodeDescriptor[], ctx: EndgeFederationContext) => readonly EndgeLifecycleNodeDescriptor[]
}

/** Полное декларативное описание автоматически собираемой федерации. */
export interface EndgeFederationDefinition<
  TDefinitions extends EndgeModuleDefinitions,
  TFederations extends EndgeChildFederationDefinitions = readonly [],
> {
  readonly id: string
  readonly name?: string
  readonly modules: TDefinitions
  readonly federations?: TFederations
  /** Selects an ordered subset once per boot; reset uses the same nodes. */
  readonly selectLifecycleNodes?: (nodes: readonly EndgeLifecycleNodeDescriptor[], ctx: EndgeFederationContext) => readonly EndgeLifecycleNodeDescriptor[]
}

export type EndgeLifecycleNodeDescriptor
  = | {
    readonly kind: 'module'
    readonly key: string
    readonly module: AnyEndgeModule
    readonly before?: EndgeModuleOrder
    readonly after?: EndgeModuleOrder
  }
  | {
    readonly kind: 'federation'
    readonly key: string
    readonly federation: AnyEndgeFederation
    readonly before?: EndgeModuleOrder
    readonly after?: EndgeModuleOrder
  }

export interface EndgeFederationHost {
  definitionSignature: string | null
  parentFederationId: string | null
  isConfigured: boolean
  isConfiguring: boolean
  isSetup: boolean
  isInitialized: boolean
  state: EndgeFederationState
  lastError: unknown | null
  bootContext: EndgeFederationContext | null
  lifecycleNodes: readonly EndgeLifecycleNodeDescriptor[] | null
  bootPromise: Promise<void> | null
  resetPromise: Promise<void> | null
  buildQueue: Promise<void>
  pendingBuilds: number
  moduleDefinitions: EndgeModuleDefinitions[number][]
  federationDefinitions: EndgeChildFederationDefinition[]
  moduleDescriptors: EndgeModuleDescriptor[]
  nodes: EndgeLifecycleNodeDescriptor[]
  modules: Map<string, EndgeModule<any>>
  federations: Map<string, AnyEndgeFederation>
  facades: Set<AnyEndgeFederation>
  plugins: EndgePlugin[]
  pluginSignatures: Map<string, string>
  installedPluginIds: Set<string>
  attachedTouchedNodes: Set<EndgeLifecycleNodeDescriptor>
}
