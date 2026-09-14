import type { ComponentSFCTagRegistryEntry, ProgramArtifact, ProgramArtifactKey } from './program.types'
import type { BundleJsonValue } from '@/features/core/kernel/types/endge-bundle.types'
import type { EndgeConfiguration } from '@/features/core/modules/configuration/domain/types/configuration.type'
import type { EndgeContextSnapshot } from '@/features/core/modules/context/domain/context-persistence.types'

export interface CompiledFolderDescriptor {
  id: string
  identity: string
  displayName: string
  parentId: string | null
  scope: 'workspace' | 'collection'
  entityType: string | null
  position: number
}

export interface CompiledDocumentDescriptor {
  id: string
  identity: string
  entityType: string
  displayName: string
  folderId: string | null
  workspaceFolderId: string | null
  position: number
  artifactKeys: ProgramArtifactKey[]
  status: 'compiled' | 'not-compiled'
}

export interface CompiledProgramCatalog {
  folders: Record<string, CompiledFolderDescriptor>
  documents: Record<string, CompiledDocumentDescriptor>
}

export type PortableProgramArtifact = ProgramArtifact<BundleJsonValue>

/** Данные одной завершённой сборки; runtime capabilities описываются отдельно от формата файла. */
export interface CompiledContextDescriptor extends EndgeContextSnapshot {
  configuration: EndgeConfiguration
}

export interface ProgramRequirements {
  artifactTypes: string[]
  componentTags: ComponentSFCTagRegistryEntry[]
}

export interface ExecutionBundle {
  version: 1
  programId: string
  compilerVersion: string
  createdAt: string
  context: CompiledContextDescriptor
  requirements: ProgramRequirements
  catalog: CompiledProgramCatalog
  artifacts: Record<ProgramArtifactKey, PortableProgramArtifact>
}

/** Подготовленные изолированные данные; install повторно проверяет их перед заменой. */
export interface PreparedProgramInstall {
  readonly bundle: ExecutionBundle
}
