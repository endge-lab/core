import { describe, expect, it } from 'vitest'

import { EndgeProgram } from '@/model/endge/program/endge-program'
import type { ProgramArtifact } from '@/domain/types/program/program.types'

describe('EndgeProgram', () => {
  it('stores and resolves artifacts by id and identity', () => {
    const program = new EndgeProgram()
    const artifact = makeArtifact('action', 10, 'save-order')

    program.beginCompile('test')
    program.addArtifact(artifact)

    expect(program.getArtifact('action', 10)).toBe(artifact)
    expect(program.getArtifact('action', 'save-order')).toBe(artifact)
  })

  it('clear removes artifacts and resets status', () => {
    const program = new EndgeProgram()
    program.beginCompile('test')
    program.addArtifact(makeArtifact('query', 'q1', 'query-one', 'error'))

    expect(program.status).toBe('error')

    program.clear()

    expect(program.status).toBe('valid')
    expect(program.getArtifact('query', 'q1')).toBeNull()
    expect(program.snapshot().total).toBe(0)
  })

  it('groups diagnostics in snapshots', () => {
    const program = new EndgeProgram()
    program.beginCompile('test')
    program.addArtifact(makeArtifact('action', 'a1', 'action-one', 'warning'))
    program.addArtifact(makeArtifact('query', 'q1', 'query-one'))

    const snapshot = program.snapshot()

    expect(snapshot.total).toBe(2)
    expect(snapshot.byStatus.warning).toBe(1)
    expect(snapshot.byEntityType.action).toBe(1)
    expect(snapshot.diagnostics).toHaveLength(1)
  })

  it('stores component tag registry only for the active compile cycle', () => {
    const program = new EndgeProgram()
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
