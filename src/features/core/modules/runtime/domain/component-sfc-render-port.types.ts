import type { ComponentSFCRuntimeHost } from '@/features/core/modules/runtime/hosts/ComponentSFCRuntimeHost'
import type { EndgeStyleSheetArtifact } from '@/features/core/modules/styles/domain/types/style.types'

/** Renderer потребляет этот порт. Его реализация не обязана быть исполняемым RuntimeHost. */
export type ComponentSFCRenderPort = Pick<ComponentSFCRuntimeHost, | 'id' | 'entityIdentity' | 'runtimeState'
  | 'getIr' | 'getArtifact' | 'getArtifactReader'
  | 'getComputationResource' | 'releaseComputationResources'
  | 'readDataMeta' | 'translate' | 'resolveVocabOptions'
  | 'getEditSession' | 'beginEditSession' | 'updateEditDraft' | 'commitEditSession' | 'cancelEditSession'
  | 'executeEventPortAction' | 'publishEventPort'
  | 'setInputSource' | 'on' | 'off' | 'emit'> & {
    readonly readonly?: boolean
    readonly styleArtifacts?: readonly EndgeStyleSheetArtifact[]
    readonly runtimeScopeIds?: readonly string[]
  }
