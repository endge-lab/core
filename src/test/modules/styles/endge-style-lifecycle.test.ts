import type { EndgeStyleProgramPayload, ProgramArtifact } from '@/modules/program/domain/types/program.types'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { Endge } from '@/kernel/endge'
import { RStyle } from '@/modules/domain/entities/RStyle'
import { compileEndgeCSS } from '@/modules/styles/services/endgecss-compile'

describe('аренда стилей Endge', () => {
  afterEach(() => {
    Endge.styles.reset()
    Endge.program.clear()
    Endge.domain.reset()
  })

  it('ведёт подсчёт ссылок владельцев и приостанавливает размещение только после паузы каждого владельца', () => {
    installStyle()
    const first = Endge.styles.acquireStyle({ artifactIdentity: 'theme', ownerScopeId: 'a', boundaryId: 'root' })
    const second = Endge.styles.acquireStyle({ artifactIdentity: 'theme', ownerScopeId: 'b', boundaryId: 'root' })
    expect(Endge.styles.getActivePlacements()[0].referenceCount).toBe(2)

    first.suspend()
    expect(Endge.styles.getActivePlacements()).toHaveLength(1)
    second.suspend()
    expect(Endge.styles.getActivePlacements()).toEqual([])
    first.resume()
    expect(Endge.styles.getActivePlacements()[0].ownerScopeIds).toEqual(['a'])

    first.release()
    first.release()
    expect(Endge.styles.getActivePlacements()).toEqual([])
    second.resume()
    expect(Endge.styles.getActivePlacements()).toHaveLength(1)
    second.release()
    expect(Endge.styles.getActivePlacements()).toEqual([])
  })

  it('сохраняет независимость границ и объединяет асинхронные транзакции в одно уведомление', async () => {
    installStyle()
    const listener = vi.fn()
    const unsubscribe = Endge.styles.subscribe(listener)
    let left!: ReturnType<typeof Endge.styles.acquireStyle>
    let right!: ReturnType<typeof Endge.styles.acquireStyle>
    await Endge.styles.transaction(async () => {
      left = Endge.styles.acquireStyle({ artifactIdentity: 'theme', ownerScopeId: 'left', boundaryId: 'left' })
      await Promise.resolve()
      right = Endge.styles.acquireStyle({ artifactIdentity: 'theme', ownerScopeId: 'right', boundaryId: 'right' })
    })
    expect(Endge.styles.getActivePlacements().map(item => item.boundaryId).sort()).toEqual(['left', 'right'])
    expect(listener).toHaveBeenCalledTimes(1)

    left.release()
    expect(Endge.styles.getActivePlacements().map(item => item.boundaryId)).toEqual(['right'])
    right.release()
    unsubscribe()
  })
})

function installStyle(): void {
  const style = RStyle.fromPlain({ id: 1, identity: 'theme', name: 'Theme', source: '.cell { color: red; }', active: true })
  Endge.domain.addStyle(style)
  const stylesheet = compileEndgeCSS(style.source, { identity: style.identity }).artifact!
  const payload: EndgeStyleProgramPayload = { stylesheet, themes: [], dependencies: [] }
  const artifact: ProgramArtifact<EndgeStyleProgramPayload> = {
    ref: { entityType: 'style', id: style.id, identity: style.identity },
    sourceHash: 'theme',
    compilerVersion: 'test',
    status: 'valid',
    diagnostics: [],
    dependencies: [],
    capabilities: ['compilable'],
    metadata: { self: {}, nodes: [] },
    payload,
  }
  Endge.program.beginCompile('style-lifecycle')
  Endge.program.addArtifact(artifact)
}
