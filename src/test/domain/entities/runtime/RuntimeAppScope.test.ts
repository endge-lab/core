import type { ProgramArtifact } from '@/domain/types/program/program.types'
import type { StoreSourceArtifact } from '@/domain/types/source/store-source.types'

import { Raph } from '@endge/raph'
import { afterEach, describe, expect, it } from 'vitest'

import { RStore } from '@/domain/entities/reflect/RStore'
import { StoreRuntimeHost } from '@/domain/entities/runtime/hosts/StoreRuntimeHost'
import { Endge } from '@/model/endge/kernel/endge'

describe('RuntimeAppScope', () => {
  afterEach(() => {
    Endge.runtime.reset()
    Endge.program.clear()
    Endge.domain.reset()
    Raph.app.reset()
  })

  it('owns preview root path and replaces the same root entity without preview suffixes', () => {
    const store = installStore()
    const preview = Endge.runtime.createAppScope({
      id: 'preview',
      rootPath: 'runtime-preview',
      collisionPolicy: 'replace',
      persistence: 'disabled',
    })

    const first = preview.execute(store) as StoreRuntimeHost
    expect(first.id).toBe('preview:store:groundhandling-db')
    expect(first.getDataPath()).toBe('runtime-preview.stores.groundhandling-db')
    expect(Raph.get('runtime-preview.stores.groundhandling-db.raw')).toEqual({ rows: [] })
    expect(Raph.get('runtime-preview.stores.groundhandling-db.table')).toEqual([])

    first.set('raw', { rows: [{ id: 1 }] })
    const second = preview.execute(store) as StoreRuntimeHost
    expect(second).not.toBe(first)
    expect(second.id).toBe(first.id)
    expect(second.getDataPath()).toBe(first.getDataPath())
    expect(second.getDataSnapshot()).toEqual({ raw: { rows: [] }, table: [] })
    expect(Endge.runtime.getRuntimeHostsByEntity('store', 'groundhandling-db', 'preview')).toEqual([second])
  })

  it('allocates identity-index local ids for multi-instance app scope', () => {
    const store = installStore()
    const app = Endge.runtime.getDefaultAppScope()

    const first = app.execute(store) as StoreRuntimeHost
    const second = app.execute(store) as StoreRuntimeHost

    expect(first.getDataPath()).toBe('runtime.stores.groundhandling-db-0')
    expect(second.getDataPath()).toBe('runtime.stores.groundhandling-db-1')
    expect(first.id).toBe('app:store:groundhandling-db-0')
    expect(second.id).toBe('app:store:groundhandling-db-1')
  })

  it('keeps the typed parent relation outside host metadata', () => {
    const store = installStore()
    const parent = Endge.runtime.execute(store, { id: 'runtime-parent' }) as StoreRuntimeHost
    const child = Endge.runtime.execute(store, {
      parent,
      meta: { role: 'child' },
    }) as StoreRuntimeHost

    expect(child.parent).toBe(parent)
    expect(child.meta.role).toBe('child')
    expect(child.meta.parent).toBeUndefined()
    expect(child.meta.scopeRoot).toBe(false)
  })

  it('derives scope root only from the parent relation', () => {
    const store = installStore()
    const app = Endge.runtime.getDefaultAppScope()
    const parent = app.execute(store) as StoreRuntimeHost
    const child = app.execute(store, { parent }) as StoreRuntimeHost

    expect(parent.meta.scopeRoot).toBe(true)
    expect(child.parent).toBe(parent)
    expect(child.meta.scopeRoot).toBe(false)
  })

  it('rejects an explicit parent that is not registered', () => {
    const store = installStore()

    expect(() => Endge.runtime.execute(store, { parent: 'missing-runtime' }))
      .toThrow('[EndgeRuntime] Parent runtime host "missing-runtime" is not registered.')
  })

  it('rejects an explicit invalid artifact reader', () => {
    const store = installStore()

    expect(() => Endge.runtime.execute(store, { artifactReader: {} as any }))
      .toThrow('[EndgeRuntime] Explicit artifactReader must implement getArtifact().')
  })
})

function installStore(): RStore {
  const store = new RStore()
  store.id = 701
  store.identity = 'groundhandling-db'
  store.name = 'Groundhandling DB'
  store.source = `defineStore({
    data: {
      raw: value({ rows: [] }),
      table: value([]),
    },
  })`
  Endge.domain.addStore(store)

  const payload = Endge.source.compile('store', store.source).artifact as StoreSourceArtifact
  const artifact: ProgramArtifact<StoreSourceArtifact> = {
    ref: { entityType: 'store', id: store.id, identity: store.identity },
    sourceHash: 'test',
    compilerVersion: 'test',
    status: 'valid',
    diagnostics: [],
    dependencies: [],
    capabilities: ['compilable', 'executable', 'data-provider'],
    metadata: { self: {}, nodes: [] },
    payload,
  }
  Endge.program.beginCompile('test')
  Endge.program.addArtifact(artifact)
  return store
}
