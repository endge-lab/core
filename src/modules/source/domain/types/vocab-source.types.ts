import type { RQueryAuth } from '@/modules/domain/types/document/query.types'
import type { ProgramMetadataMap } from '@/modules/program/domain/types/program-metadata.types'
import type { ProgramDiagnostic, QueryProgramOutput } from '@/modules/program/domain/types/program.types'

export type VocabProviderBaseUrl
  = | string
    | { kind: 'env', name: string }

export interface VocabPayloadProvider {
  kind: 'payload'
  baseUrl: VocabProviderBaseUrl
  collection: string
  auth: RQueryAuth
}

export interface VocabMockReference {
  identity: string
  path: string | null
}

export interface VocabSourceDocument {
  sourceVersion: 1
  provider: VocabPayloadProvider | null
  mock: VocabMockReference | null
  outputs: QueryProgramOutput[]
}

export interface VocabProgramPayload extends VocabSourceDocument {
  ast?: unknown
  sourceDocument?: VocabSourceDocument | null
}

export interface VocabSourceCompileResult {
  ast: unknown
  document: VocabSourceDocument | null
  artifact: VocabProgramPayload | null
  metadata: ProgramMetadataMap
  diagnostics: Array<Omit<ProgramDiagnostic, 'entityRef'>>
}

export interface VocabSourcePatch {
  mock: VocabMockReference | null
}
