import { describe, expect, it } from 'vitest'

import { compileComputation } from '@/features/core/modules/compiler/services/computation/computation-compile'
import { patchDocumentMetadata } from '@/features/core/modules/domain/documents/document-metadata'
import { compileActionSource } from '@/features/core/modules/source/services/compilers/action-source-compile'
import { compileConfigurationSource } from '@/features/core/modules/source/services/compilers/configuration-source-compile'
import { compileSimulationSource } from '@/features/core/modules/source/services/compilers/simulation-source-compile'
import { compileStoreSource } from '@/features/core/modules/source/services/compilers/store-source-compile'
import { compileStreamSource } from '@/features/core/modules/source/services/compilers/stream-source-compile'
import { compileTypeSource } from '@/features/core/modules/source/services/compilers/type-source-compile'
import { compileUpdateSource } from '@/features/core/modules/source/services/compilers/update-source-compile'
import { compileVocabSource } from '@/features/core/modules/source/services/compilers/vocab-source-compile'
import { ACTION_DEFAULT_SOURCE } from '@/features/core/modules/source/templates/action.default.source'
import { COMPUTATION_DEFAULT_SOURCE } from '@/features/core/modules/source/templates/computation.default.source'
import { CONFIGURATION_DEFAULT_SOURCE } from '@/features/core/modules/source/templates/configuration.default.source'
import { SIMULATION_DEFAULT_SOURCE } from '@/features/core/modules/source/templates/simulation.default.source'
import { STORE_DEFAULT_SOURCE } from '@/features/core/modules/source/templates/store.default.source'
import { STREAM_DEFAULT_SOURCE } from '@/features/core/modules/source/templates/stream.default.source'
import { TYPE_DEFAULT_SOURCE } from '@/features/core/modules/source/templates/type.default.source'
import { UPDATE_DEFAULT_SOURCE } from '@/features/core/modules/source/templates/update.default.source'
import { VOCAB_DEFAULT_SOURCE } from '@/features/core/modules/source/templates/vocab.default.source'

const metadata = { 'company.feature': { owner: 'operations' } }

describe('source compiler document metadata', () => {
  const propertyCases = [
    ['action', ACTION_DEFAULT_SOURCE, (source: string) => compileActionSource({ source })],
    ['computation', COMPUTATION_DEFAULT_SOURCE, (source: string) => compileComputation({ source })],
    ['store', STORE_DEFAULT_SOURCE, compileStoreSource],
    ['stream', STREAM_DEFAULT_SOURCE, compileStreamSource],
    ['simulation', SIMULATION_DEFAULT_SOURCE, compileSimulationSource],
    ['update', UPDATE_DEFAULT_SOURCE, compileUpdateSource],
    ['vocabs', VOCAB_DEFAULT_SOURCE, compileVocabSource],
  ] as const

  for (const [type, source, compile] of propertyCases) {
    it(`returns metadata for ${type}`, () => {
      const patched = patchDocumentMetadata(type, { source }, metadata)
      expect(patched.ok).toBe(true)
      expect(compile(patched.source).metadata).toEqual(metadata)
    })
  }

  it('returns defineMetadata for Type and Configuration', () => {
    const type = patchDocumentMetadata('type', { source: TYPE_DEFAULT_SOURCE }, metadata)
    const configuration = patchDocumentMetadata('configuration', { source: CONFIGURATION_DEFAULT_SOURCE }, metadata)

    expect(compileTypeSource(type.source).metadata).toEqual(metadata)
    expect(compileConfigurationSource(configuration.source).metadata).toEqual(metadata)
  })
})
