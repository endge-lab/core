import type { ProgramArtifact } from '@/features/core/modules/program/domain/types/program.types'

import { describe, expect, it } from 'vitest'
import { EndgeProgram_Module } from '@/features/core/modules/program/EndgeProgram_Module'

describe('проверка Program в Endge', () => {
  it('хранит и разрешает артефакты по ID и identity', () => {
    const program = new EndgeProgram_Module()
    const artifact = makeArtifact('action', 10, 'save-order')

    program.beginCompile('test')
    program.addArtifact(artifact)

    expect(program.getArtifact('action', 10)).toBe(artifact)
    expect(program.getArtifact('action', 'save-order')).toBe(artifact)
  })

  it('clear удаляет артефакты и сбрасывает status', () => {
    const program = new EndgeProgram_Module()
    program.beginCompile('test')
    program.addArtifact(makeArtifact('query', 'q1', 'query-one', 'error'))

    expect(program.status).toBe('error')

    program.clear()

    expect(program.status).toBe('valid')
    expect(program.getArtifact('query', 'q1')).toBeNull()
    expect(program.snapshot().total).toBe(0)
  })

  it('группирует диагностику в snapshots', () => {
    const program = new EndgeProgram_Module()
    program.beginCompile('test')
    program.addArtifact(makeArtifact('action', 'a1', 'action-one', 'warning'))
    program.addArtifact(makeArtifact('query', 'q1', 'query-one'))

    const snapshot = program.snapshot()

    expect(snapshot.total).toBe(2)
    expect(snapshot.byStatus.warning).toBe(1)
    expect(snapshot.byEntityType.action).toBe(1)
    expect(snapshot.diagnostics).toHaveLength(1)
  })

  it('хранит реестр тегов компонентов только для активного цикла компиляции', () => {
    const program = new EndgeProgram_Module()
    program.beginCompile('test')
    program.setComponentTags([
      { tag: 'Tail', identity: 'aircraft-tail' },
      { tag: 'Module.SomeTag', identity: 'aircraft-type' },
    ])

    expect(program.resolveComponentTag('Tail')).toBe('aircraft-tail')
    expect(program.getComponentTags()).toEqual([
      { tag: 'Tail', identity: 'aircraft-tail' },
      { tag: 'Module.SomeTag', identity: 'aircraft-type' },
    ])

    program.clear()
    expect(program.resolveComponentTag('Tail')).toBeNull()
  })
})

function makeArtifact(
  entityType: ProgramArtifact['ref']['entityType'],
  id: string | number,
  identity: string,
  status: ProgramArtifact['status'] = 'valid',
): ProgramArtifact {
  return {
    ref: { entityType, id, identity },
    sourceHash: 'hash',
    compilerVersion: 'test',
    status,
    diagnostics: status === 'valid'
      ? []
      : [{
          severity: status === 'error' ? 'error' : 'warning',
          code: 'test',
          message: 'Test diagnostic',
        }],
    dependencies: [],
    capabilities: ['compilable'],
    metadata: { self: {}, nodes: [] },
    payload: {},
  }
}
