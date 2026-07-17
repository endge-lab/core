import { afterEach, describe, expect, it, vi } from 'vitest'

import { RStyle } from '@/domain/entities/reflect/RStyle'
import { Endge } from '@/model/endge/kernel/endge'
import { compileEndgeCSS } from '@/model/services/style'

describe('Endge style leases', () => {
  afterEach(() => {
    Endge.styles.reset()
    Endge.program.clear()
    Endge.domain.reset()
  })

  it('reference-counts one placement and suspends owners independently', () => {
    const style = RStyle.fromPlain({
      id: 900,
      identity: 'shared-theme',
      name: 'Shared theme',
      source: '.cell { color: red; }',
    })
    Endge.domain.addStyle(style)
    Endge.program.beginCompile('style-lease')
    addStyleArtifact(style)

    const first = Endge.styles.acquireStyle({
      artifactIdentity: 'shared-theme',
      ownerScopeId: 'scope:first',
      boundaryId: 'project',
      orderKey: '01:shared-theme',
    })
    const second = Endge.styles.acquireStyle({
      artifactIdentity: 'shared-theme',
      ownerScopeId: 'scope:second',
      boundaryId: 'project',
      orderKey: '01:shared-theme',
    })

    expect(Endge.styles.getActivePlacements()).toEqual([
      expect.objectContaining({ referenceCount: 2, ownerScopeIds: ['scope:first', 'scope:second'] }),
    ])
    first.suspend()
    expect(Endge.styles.getActivePlacements()[0].ownerScopeIds).toEqual(['scope:second'])
    second.suspend()
    expect(Endge.styles.getActivePlacements()).toEqual([])
    first.resume()
    expect(Endge.styles.getActiveArtifacts()).toHaveLength(1)
    first.release()
    second.release()
    expect(Endge.styles.getActivePlacements()).toEqual([])
  })

  it('emits one change notification for an async transaction', async () => {
    const style = RStyle.fromPlain({ id: 901, identity: 'atomic-theme', name: 'Atomic', source: 'Text { color: red; }' })
    Endge.domain.addStyle(style)
    Endge.program.beginCompile('style-transaction')
    addStyleArtifact(style)
    const changed = vi.fn()
    const unsubscribe = Endge.styles.subscribe(changed)

    await Endge.styles.transaction(async () => {
      const lease = Endge.styles.acquireStyle({
        artifactIdentity: 'atomic-theme',
        ownerScopeId: 'scope',
        boundaryId: 'scope',
      })
      await Promise.resolve()
      lease.suspend()
      lease.resume()
    })

    expect(changed).toHaveBeenCalledTimes(1)
    unsubscribe()
  })
})

function addStyleArtifact(style: RStyle): void {
  const stylesheet = compileEndgeCSS(style.source, { identity: style.identity }).artifact!
  Endge.program.addArtifact({
    ref: { entityType: 'style', id: style.id, identity: style.identity },
    sourceHash: stylesheet.sourceHash,
    compilerVersion: 'test',
    contextHash: 'test',
    status: 'valid',
    diagnostics: [],
    dependencies: [],
    capabilities: ['compilable'],
    metadata: { self: {}, nodes: [] },
    payload: { stylesheet, themes: [], dependencies: [] },
  })
}
