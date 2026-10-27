import type { ProgramArtifact, QueryProgramPayload } from '@/features/core/modules/program/domain/types/program.types'
import type { CompositionProgramPayload } from '@/features/core/modules/source/domain/types/composition-source.types'

import { Raph } from '@raphy-js/raph'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Endge } from '@/features/core/kernel/endge'
import { RComposition } from '@/features/core/modules/domain/entities/RComposition'
import { RQuery } from '@/features/core/modules/domain/entities/RQuery'
import { compileCompositionSource } from '@/features/core/modules/source/services/compilers/composition-source-compile'

describe('composition activateWhen во время работы', () => {
  afterEach(async () => {
    await Endge.runtime.reset()
    Endge.program.clear()
    Endge.domain.reset()
    Raph.reset()
  })

  it('активирует и деактивирует runtime и scope при изменении данных', async () => {
    Raph.set('flags.details', false)
    Raph.set('flags.panel', true)
    register(`defineComposition({
      runtimes: {
        base: query('base-query'),
        details: query('details-query').activateWhen(fromStore('flags.details')),
        panel: scope({
          runtimes: { rows: query('rows-query') },
        }).activateWhen(fromStore('flags.panel')),
      },
    })`, ['base-query', 'details-query', 'rows-query'])

    const session = await Endge.runtime.composition.mount('conditional')
    const details = session.host.getRuntimeHandle('details')!
    const panel = session.host.getScope('panel')!
    // Начальное состояние согласовано с данными сразу после mount.
    expect(session.host.getChild('base')).not.toBeNull()
    expect(details.runtime).toBeNull()
    expect(panel.state).toBe('active')
    expect(session.host.getChild('panel.rows')).not.toBeNull()

    Raph.set('flags.details', true)
    await vi.waitFor(() => expect(details.state).toBe('active'))
    expect(session.host.getChild('details')).not.toBeNull()

    Raph.set('flags.panel', false)
    await vi.waitFor(() => expect(panel.state).toBe('inactive'))
    expect(session.host.getChild('panel.rows')).toBeNull()

    Raph.set('flags.details', false)
    await vi.waitFor(() => expect(details.runtime).toBeNull())

    Raph.set('flags.panel', true)
    await vi.waitFor(() => expect(session.host.getChild('panel.rows')).not.toBeNull())

    await session.unmount()
  })

  it('частые переключения сходятся к последнему значению', async () => {
    Raph.set('flags.details', false)
    register(`defineComposition({
      runtimes: { details: query('details-query').activateWhen(fromStore('flags.details')) },
    })`, ['details-query'])
    const session = await Endge.runtime.composition.mount('conditional')
    const details = session.host.getRuntimeHandle('details')!
    for (const value of [true, false, true, false, true]) {
      Raph.set('flags.details', value)
    }
    await vi.waitFor(() => expect(details.state).toBe('active'))
    Raph.set('flags.details', false)
    await vi.waitFor(() => expect(details.runtime).toBeNull())
    await session.unmount()
  })
})

function register(source: string, queries: string[]): void {
  const compiled = compileCompositionSource(source)
  expect(compiled.diagnostics.filter(item => item.severity === 'error')).toEqual([])
  queries.forEach((identity, index) => {
    const model = new RQuery()
    model.id = 700 + index
    model.identity = identity
    model.name = identity
    Endge.domain.addQuery(model)
    Endge.program.addArtifact(artifact<QueryProgramPayload>('query', model.id, identity, {
      type: 'query-rest',
      sourceVersion: 2,
      endpoint: '',
      query: '',
      requestBody: null,
      props: [],
      outputs: [],
    } as unknown as QueryProgramPayload))
  })
  const composition = new RComposition()
  composition.id = 799
  composition.identity = 'conditional'
  composition.name = 'Conditional'
  Endge.domain.addComposition(composition)
  Endge.program.addArtifact(artifact('composition', composition.id, composition.identity, compiled.artifact as CompositionProgramPayload))
}

function artifact<T>(entityType: 'query' | 'composition', id: number, identity: string, payload: T): ProgramArtifact<T> {
  return {
    ref: { entityType, id, identity },
    sourceHash: `test:${identity}`,
    compilerVersion: 'test',
    contextHash: 'test',
    status: 'valid',
    diagnostics: [],
    dependencies: [],
    capabilities: ['compilable', 'executable'],
    metadata: { self: {}, nodes: [] },
    payload,
  }
}
