import type { RQueryAuth } from '@/domain/types/document/query.types'
import type { ProgramDiagnostic, QueryProgramOutput } from '@/domain/types/program/program.types'
import type { ProgramMetadataMap } from '@/domain/types/program/program-metadata.types'

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
