import type { ProgramArtifact } from '@/features/core/modules/program/domain/types/program.types'
import type { StoreRuntimeHost } from '@/features/core/modules/runtime/hosts/StoreRuntimeHost'
import type { StoreSourceArtifact } from '@/features/core/modules/source/domain/types/store-source.types'

import type { UpdateSourceArtifact } from '@/features/core/modules/source/domain/types/update-source.types'
import { Endge } from '@/features/core/kernel/endge'
import { RStore } from '@/features/core/modules/domain/entities/RStore'
import { RUpdate } from '@/features/core/modules/domain/entities/RUpdate'

export function createUpdateStoreRuntime(input: {
  storeSource: string
  updates: Array<{ identity: string, source: string, handles?: string[] }>
}): StoreRuntimeHost {
  const store = new RStore()
  store.id = 700
  store.identity = 'test-update-store'
  store.name = 'Test Update Store'
  store.source = input.storeSource
  Endge.domain.addStore(store)

  const storePayload = Endge.source.compile('store', store.source).artifact as StoreSourceArtifact
  storePayload.updateHandlers = []
  Endge.program.beginCompile('test-update')

  input.updates.forEach((definition, index) => {
    const update = new RUpdate()
    update.id = 701 + index
    update.identity = definition.identity
    update.name = definition.identity
    update.storeIdentity = store.identity
    update.source = definition.source
    Endge.domain.addUpdate(update)
    const compiled = Endge.source.compile('update', update.source).artifact as Omit<UpdateSourceArtifact, 'storeIdentity'>
    storePayload.updateHandlers.push({ identity: update.identity, eventTypes: definition.handles ?? compiled.handles })
    Endge.program.addArtifact(artifact('update', update.id, update.identity, {
      ...compiled,
      storeIdentity: store.identity,
    }))
  })
  Endge.program.addArtifact(artifact('store', store.id, store.identity, storePayload))
  return Endge.runtime.execute(store, { id: 'test-update-store-runtime' }) as StoreRuntimeHost
}

function artifact<T>(entityType: 'store' | 'update', id: number, identity: string, payload: T): ProgramArtifact<T> {
  return {
    ref: { entityType, id, identity },
    sourceHash: 'test',
    compilerVersion: 'test',
    status: 'valid',
    diagnostics: [],
    dependencies: [],
    capabilities: ['compilable', 'executable'],
    metadata: { self: {}, nodes: [] },
    payload,
  }
}
