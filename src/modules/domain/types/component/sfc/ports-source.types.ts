import type { RComponentSFC_SourceRange } from './location.types'

import type { ComponentSFCEventSource, ComponentSFCPortManifest, ComponentSFCPortRole } from './ports.types'
import type { RComponentDiagnostic } from '@/modules/domain/types/component/component-core.types'

export interface ComponentSFCPortsSourceProjection {
  editable: boolean
  message?: string
  bindingName: string | null
  manifest: ComponentSFCPortManifest
  sourceRange?: RComponentSFC_SourceRange
  diagnostics: RComponentDiagnostic[]
}

/** Сохраняющий Source CRUD для визуальных редакторов Ports и Events. */
export type ComponentSFCPortsSourcePatch
  = | {
    type: 'upsert-port'
    role: ComponentSFCPortRole
    name: string
    /** Полное выражение фабрики, например `event<RowEvent>()`. */
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
    /** Исходное выражение Action: `{ identity: ... }` или `typescript({...})`. */
    actionSource?: string | null
  }
  | {
    type: 'remove-event-action'
    name: string
  }
  | {
    type: 'set-forward'
    /** Исходное значение `forward`; null удаляет секцию. */
    declaration: string | null
  }

export interface ComponentSFCPortsSourcePatchResult {
  ok: boolean
  changed: boolean
  source: string
  projection: ComponentSFCPortsSourceProjection
  message?: string
}
