import { describe, expect, it } from 'vitest'

import { compileCompositionSource } from '@/model/services/source-engine/compilers/composition-source-compile'

const sourceHead = `defineComposition({
  data: { telegraph: store('telegraph') },
  runtimes: {
    table: component('telegraph').withProps({ rows: fromData('telegraph.rows') }),
  },`

describe('Composition Component event source', () => {
  it('allows automatic Component dispatchTo without Stream batching', () => {
    const result = compileCompositionSource(`defineComposition({
      data: { telegraph: store('telegraph') },
      runtimes: {
        table: component('telegraph')
          .withProps({ rows: fromData('telegraph.rows') })
          .dispatchTo(data('telegraph')),
      },
    })`)

    expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([])
    expect(result.artifact?.runtimes[0]?.dispatchTo).toEqual(['telegraph'])
  })

  it('compiles named Update, inline mutation and Action effects', () => {
    const result = compileCompositionSource(`${sourceHead}
      hooks: [
        onEvent('table', 'edited').applyUpdate(data('telegraph'), update('telegraph-update-row')),
        onEvent('table', 'selected').mutate(data('telegraph'), {
          strategy: 'merge',
          path: 'rows[id=$id]',
          value: event('patch'),
          vars: { id: event('id') },
        }),
        onEvent('table', 'saved').executeAction(action('telegraph.save'), { row: event() }),
      ],
    })`)

    expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([])
    expect(result.artifact?.graph.events).toMatchObject([
      { runtime: 'table', event: 'edited', effect: { kind: 'apply-update', data: 'telegraph', update: 'telegraph-update-row' } },
      { runtime: 'table', event: 'selected', effect: { kind: 'mutate-store', mutation: { path: 'rows[id=$id]' } } },
      { runtime: 'table', event: 'saved', effect: { kind: 'execute-action', action: 'telegraph.save' } },
    ])
  })

  it('rejects multiple terminal effects and non-component sources', () => {
    const result = compileCompositionSource(`defineComposition({
      data: { telegraph: store('telegraph') },
      runtimes: { query: query('rows') },
      hooks: [onEvent('query', 'edited').applyUpdate(data('telegraph'), update('u')).executeAction(action('a'))],
    })`)
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'composition-event-runtime-kind', severity: 'error' }),
    ]))
  })
})
