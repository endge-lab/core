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

/** Публичный lifecycle-контракт статического facade Federation. */
export interface EndgeFederationFacade<in TContext extends EndgeFederationContext = EndgeFederationContext> {
  readonly id: string
  readonly isConfigured: boolean
  readonly isInitialized: boolean
  readonly lastError: unknown | null
  readonly state: EndgeFederationState
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
