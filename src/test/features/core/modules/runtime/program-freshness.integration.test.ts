import type { QueryRuntimeHost } from '@/features/core/modules/runtime/hosts/QueryRuntimeHost'
import { Raph } from '@endge/raph'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Endge } from '@/features/core/kernel/endge'
import { RQuery } from '@/features/core/modules/domain/entities/RQuery'
import { RStore } from '@/features/core/modules/domain/entities/RStore'
import { StoreRuntimeHost } from '@/features/core/modules/runtime/hosts/StoreRuntimeHost'
import { prepareTestCompilerContext, resetTestCompilerContext } from '@/test/helpers/compiler-context'

function store() {
  const model = Object.assign(new RStore(), { id: 100, identity: 'fresh-store', name: 'Fresh Store', source: 'defineStore({data:{counter:value(0)}})' })
  Endge.domain.addStore(model)
  const artifact = Endge.compiler.buildStore(model)
  expect(artifact.status).toBe('valid')
  return { model, artifact }
}

describe('актуальность Program перед runtime side effects', () => {
  beforeEach(prepareTestCompilerContext)
  afterEach(async () => {
    vi.restoreAllMocks()
    await Endge.runtime.reset()
    resetTestCompilerContext()
    Raph.app.reset()
  })

  /** Изменённый Source требует явной компиляции; runtime не должен читать старое значение. */
  it('блокирует stale Source до создания host и разрешает новый artifact после rebuild', () => {
    const { model } = store()
    const create = vi.spyOn(StoreRuntimeHost, 'createRuntime')
    model.source = 'defineStore({data:{counter:value(99)}})'
    expect(Endge.runtime.execute(model)).toBeNull()
    expect(create).not.toHaveBeenCalled()
    expect(Endge.program.getStoreArtifact(model.id)?.diagnostics).toContainEqual(expect.objectContaining({ code: 'program-artifact-stale' }))
    Endge.compiler.buildStore(model)
    expect(Endge.program.status).toBe('valid')
    const host = Endge.runtime.execute(model) as StoreRuntimeHost
    expect(host.getDataSnapshot()).toEqual({ counter: 99 })
  })

  it.each(['sourceVersion', 'compilerVersion', 'context', 'removed', 'replaced'] as const)(
    'отклоняет прежний artifact при изменении %s',
    (change) => {
      const { model, artifact } = store()
      if (change === 'sourceVersion') {
        model.sourceVersion += 1
      }
      if (change === 'compilerVersion') {
        artifact.compilerVersion = 'obsolete'
      }
      if (change === 'context') {
        Endge.workspace.apply({ ...Endge.workspace.current, identity: 'another-workspace' })
        Endge.configuration.build({ dataProvider: 'plain', scope: {}, vars: {}, context: { projectIdentity: 'test-project', environmentIdentity: 'test-environment', tenantIdentity: 'test-tenant' } })
      }
      if (change === 'removed') {
        Endge.domain.removeStore(model.id)
      }
      if (change === 'replaced') {
        const next = Object.assign(new RStore(), { ...model, source: 'defineStore({data:{counter:value(2)}})' })
        Endge.domain.replacePersistedEntity(model, next)
      }
      expect(Endge.runtime.execute(model)).toBeNull()
      expect(Endge.program.getStoreArtifact(model.id)?.status).toBe('error')
    },
  )

  it('не запускает transport существующего Query после изменения Source', async () => {
    const query = Object.assign(new RQuery(), { id: 101, identity: 'fresh-query', name: 'Fresh query', source: 'defineQuery({kind:\'rest\',request:{endpoint:\'https://example.test\',path:\'/first\',method:\'GET\'},outputs:{raw:output().from(response())}})' })
    Endge.domain.addQuery(query)
    expect(Endge.compiler.buildQuery(query).status).toBe('valid')
    const host = Endge.runtime.execute(query) as QueryRuntimeHost
    const transport = vi.spyOn(Endge.runtime.query, 'executeArtifact').mockResolvedValue({})
    query.source = query.source.replace('/first', '/second')
    await expect(host.run()).rejects.toThrow('artifact')
    expect(transport).not.toHaveBeenCalled()
  })

  it.each(['read-before-rebuild', 'rebuild-before-read'])('инвалидирует зависимый artifact: %s', (order) => {
    const { model, artifact } = store()
    Endge.program.addArtifact({
      ...artifact,
      ref: { entityType: 'store', id: 102, identity: 'dependent' },
      diagnostics: [],
      dependencies: [{ entityType: 'store', id: model.id, identity: model.identity, role: 'source' }],
    })
    model.source = 'defineStore({data:{counter:value(99)}})'
    if (order === 'rebuild-before-read') {
      Endge.compiler.buildStore(model)
    }
    expect(Endge.program.getStoreArtifact('dependent')?.diagnostics).toContainEqual(expect.objectContaining({ code: 'program-dependency-stale' }))
  })

  it('снимает старый identity index после переименования и перекомпиляции', () => {
    const { model } = store()
    model.identity = 'renamed-store'
    Endge.compiler.buildStore(model)
    expect(Endge.program.getStoreArtifact('fresh-store')).toBeNull()
    expect(Endge.program.getStoreArtifact('renamed-store')?.status).toBe('valid')
  })
})
