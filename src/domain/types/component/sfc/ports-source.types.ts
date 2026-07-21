import type { RComponentDiagnostic } from '@/domain/types/component/component-core.types'

import type { ComponentSFCEventSource, ComponentSFCPortManifest, ComponentSFCPortRole } from './ports.types'
import type { RComponentSFC_SourceRange } from './location.types'

export interface ComponentSFCPortsSourceProjection {
  editable: boolean
  message?: string
  bindingName: string | null
  manifest: ComponentSFCPortManifest
  sourceRange?: RComponentSFC_SourceRange
  diagnostics: RComponentDiagnostic[]
}

/** Source-preserving CRUD used by the visual Ports and Events editors. */
export type ComponentSFCPortsSourcePatch
  = | {
    type: 'upsert-port'
    role: ComponentSFCPortRole
    name: string
    /** Complete factory expression, for example `event<RowEvent>()`. */
    declaration: string
  }
    | {
      type: 'remove-port'
      role: ComponentSFCPortRole
      name: string
    }
    | {
      type: 'set-event'
      name: string
      payloadType: string
      from?: ComponentSFCEventSource | null
      /** Raw Action expression (`{ identity: ... }` or `typescript({...})`). */
      actionSource?: string | null
    }
    | {
      type: 'remove-event-action'
      name: string
    }
    | {
      type: 'set-forward'
      /** Raw value of `forward`; null removes the section. */
      declaration: string | null
    }

export interface ComponentSFCPortsSourcePatchResult {
  ok: boolean
  changed: boolean
  source: string
  projection: ComponentSFCPortsSourceProjection
  message?: string
}
