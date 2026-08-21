import type { RComponentContractInput } from '@/domain/types/component/component-core.types'

import type { RComponentSFC_IR_Value } from './ir.types'
import type { RComponentSFC_SourceRange } from './location.types'

export type ComponentSFCPortRole = 'require' | 'provides' | 'emits'
export type ComponentSFCPortKind = 'computation' | 'component' | 'action' | 'query' | 'event'
export type ComponentSFCRequiredPortKind = Exclude<ComponentSFCPortKind, 'event'>

/** Public child port selected by a compile-time `definePorts.forward` rule. */
export interface ComponentSFCPortForwardOrigin {
  nodeId: string
  ref?: string
  componentIdentity?: string
  componentTag: string
  portName: string
}

/** Normalized selector for one port direction inside a forward rule. */
export interface ComponentSFCPortForwardSelector {
  include: '*' | string[]
  exclude: string[]
  rename: Record<string, string>
  namespace?: 'none' | 'ref' | string
}

/** Compile-time forwarding rule persisted in the Component SFC artifact. */
export interface ComponentSFCPortForwardRule {
  from: '*' | string[]
  ports: Partial<Record<ComponentSFCPortRole, ComponentSFCPortForwardSelector>>
  namespace: 'none' | 'ref' | string
  sourceRange?: RComponentSFC_SourceRange
}

/** Default provider descriptor, supplied by the domain build boundary. */
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

/** Computation port declared by `computation<Input, Output>`. */
export interface ComponentSFCComputationPort {
  kind: 'computation'
  name: string
  defaultIdentity: string
  inputType: string
  outputType: string
  forwardedFrom?: ComponentSFCPortForwardOrigin
  sourceRange?: RComponentSFC_SourceRange
}

/** Component port declared by `component<Props>`. */
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

/** Callable Action required from the outside or provided by this component. */
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

/** Callable Query required by a component. */
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

/** One static provider override attached to a mounted child Component SFC call. */
export interface ComponentSFCRequiredPortBinding {
  port: string
  kind: ComponentSFCRequiredPortKind
  identity: string
  sourceRange?: RComponentSFC_SourceRange
}

/** Multicast notification emitted by this component. */
export interface ComponentSFCEventPort {
  kind: 'event'
  role: 'emits'
  name: string
  /** Human-readable catalog label. Identity remains based on `name`. */
  displayName?: string
  payloadType: string
  /** Optional local producer whose Event is republished by this component. */
  from?: ComponentSFCEventSource
  /** Optional reaction executed after the Event occurrence is published. */
  action?: ComponentSFCEventAction
  forwardedFrom?: ComponentSFCPortForwardOrigin
  sourceRange?: RComponentSFC_SourceRange
}

/** Literal child Event reference used by `event({ from })`. */
export interface ComponentSFCEventSource {
  ref: string
  event: string
}

/** Renderer-neutral safe expression mapped into an Event reaction input. */
export type ComponentSFCEventInputValue
  = | { kind: 'event', path: string | null }
    | { kind: 'now' }
    | { kind: 'scope', path: string }
    | { kind: 'literal', value: unknown }
    | { kind: 'array', items: ComponentSFCEventInputValue[] }
    | { kind: 'object', entries: ComponentSFCEventInputEntry[] }

export interface ComponentSFCEventInputEntry {
  key: string | ComponentSFCEventInputValue
  value: ComponentSFCEventInputValue
}

/** One Action selected directly in Component SFC Source. */
export interface ComponentSFCEventDirectAction {
  kind: 'action'
  identity: string
  input?: ComponentSFCEventInputValue
}

/** One Query selected directly in Component SFC Source. */
export interface ComponentSFCEventDirectQuery {
  kind: 'query'
  identity: string
  input?: ComponentSFCEventInputValue
}

/** Sandboxed TypeScript reaction. Its result is a validated list of effects. */
export interface ComponentSFCEventTypescriptAction {
  kind: 'typescript'
  inputs: Record<string, { kind: 'event', path: string | null }>
  /** Original `typescript({...})` expression for source projection/editor round-trips. */
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

/** Calls one required executable port through its effective per-instance provider. */
export interface ComponentSFCEventRequiredPortAction {
  kind: 'required-port'
  portKind: 'action' | 'query'
  port: string
  input?: ComponentSFCEventInputValue
}

export type ComponentSFCEventAction
  = ComponentSFCEventDirectAction
    | ComponentSFCEventDirectQuery
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

/** Typed port manifest stored in the compiled ComponentSFC artifact. */
export interface ComponentSFCPortManifest {
  require: ComponentSFCRequiredPorts
  provides: ComponentSFCProvidedPorts
  emits: ComponentSFCEmittedPorts
  forward: {
    rules: ComponentSFCPortForwardRule[]
  }
}

/** One top-level local initialized through a computation port call. */
export interface RComponentSFC_IR_PortCall {
  kind: 'computation'
  local: string
  port: string
  defaultIdentity: string
  input: RComponentSFC_IR_Value
  sourceRange?: RComponentSFC_SourceRange
}

/** Marker on a nested Component IR node created from a local component port. */
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
