import type { RComponentContractInput } from '@/domain/types/component/component-core.types'

import type { RComponentSFC_IR_Value } from './ir.types'
import type { RComponentSFC_SourceRange } from './location.types'

export type ComponentSFCPortRole = 'request' | 'provides' | 'emits'
export type ComponentSFCPortKind = 'computation' | 'component' | 'action' | 'event'

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

/** Computation port declared by `computation<Input, Output>`. */
export interface ComponentSFCComputationPort {
  kind: 'computation'
  name: string
  defaultIdentity: string
  inputType: string
  outputType: string
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
  sourceRange?: RComponentSFC_SourceRange
}

/** Callable Action required from the outside or provided by this component. */
export interface ComponentSFCActionPort {
  kind: 'action'
  role: 'request' | 'provides'
  name: string
  inputType: string
  outputType: string
  defaultIdentity?: string
  sourceRange?: RComponentSFC_SourceRange
}

/** Multicast notification emitted by this component. */
export interface ComponentSFCEventPort {
  kind: 'event'
  role: 'emits'
  name: string
  payloadType: string
  sourceRange?: RComponentSFC_SourceRange
}

export interface ComponentSFCRequestedPorts {
  computations: ComponentSFCComputationPort[]
  components: ComponentSFCComponentPort[]
  actions: ComponentSFCActionPort[]
}

export interface ComponentSFCProvidedPorts {
  actions: ComponentSFCActionPort[]
}

export interface ComponentSFCEmittedPorts {
  events: ComponentSFCEventPort[]
}

/** Typed port manifest stored in the compiled ComponentSFC artifact. */
export interface ComponentSFCPortManifest {
  request: ComponentSFCRequestedPorts
  provides: ComponentSFCProvidedPorts
  emits: ComponentSFCEmittedPorts
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
    request: {
      computations: [],
      components: [],
      actions: [],
    },
    provides: {
      actions: [],
    },
    emits: {
      events: [],
    },
  }
}
