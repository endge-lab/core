import type { SourceContextValues } from '@/features/core/modules/source/domain/types/source-context.types'

import { describe, expect, it } from 'vitest'

import { compileCompositionSource } from '@/features/core/modules/source/services/compilers/composition-source-compile'
import { runWithSourceContext } from '@/features/core/modules/source/services/source-context'

const AFL: SourceContextValues = { facets: { tenant: 'afl' }, config: {} }
const KZN: SourceContextValues = { facets: { tenant: 'kzn' }, config: {} }

const SOURCE = `defineComposition({
  data: { flight: store('flight-store') },
  runtimes: {
    flight: query('flight'),
    stands: query('kzn-stands')
      .enabledWhen(context({ tenant: 'kzn' }))
      .withProps({ id: fromOutput('flight', 'id') }),
    kzn: scope({
      runtimes: {
        panel: component('kzn-panel').withProps({ stands: fromOutput('stands', 'rows') }),
      },
    }).enabledWhen(context({ tenant: 'kzn' })),
    details: component('details').activateWhen(fromData('flight.selected')),
  },
  hooks: [
    onMount().run('flight'),
    onSuccess('flight').run('stands'),
  ],
})`

function codes(result: { diagnostics: Array<{ code: string, severity: string }> }, severity?: string): string[] {
  return result.diagnostics.filter(item => !severity || item.severity === severity).map(item => item.code)
}

describe('composition enabledWhen и activateWhen (компиляция)', () => {
  it('исключает runtime и scope из программы при несовпадении фасета', () => {
    const afl = runWithSourceContext(AFL, () => compileCompositionSource(SOURCE))
    expect(codes(afl, 'error')).toEqual([])
    expect(afl.artifact?.runtimes.map(item => item.name)).toEqual(['flight', 'details'])
    expect(afl.artifact?.scopes.map(item => item.path)).toEqual(['scope_default'])
    expect(afl.artifact?.hooks.map(item => item.kind)).toEqual(['mount'])
    expect(afl.artifact?.graph.inputs.map(item => item.targetRuntime)).not.toContain('stands')
    expect(afl.artifact?.graph.successes).toEqual([])
  })

  it('оставляет элементы при совпадении и хранит условие для инспекции', () => {
    const kzn = runWithSourceContext(KZN, () => compileCompositionSource(SOURCE))
    expect(codes(kzn, 'error')).toEqual([])
    expect(kzn.artifact?.runtimes.map(item => item.name)).toEqual(['flight', 'stands', 'kzn.panel', 'details'])
    expect(kzn.artifact?.runtimes.find(item => item.name === 'kzn.panel')?.enabledWhen).toEqual({ tenant: 'kzn' })
    expect(kzn.artifact?.scopes.find(item => item.path === 'kzn')?.enabledWhen).toEqual({ tenant: 'kzn' })
    expect(kzn.artifact?.graph.successes?.map(item => item.targetRuntime)).toEqual(['stands'])
  })

  it('через executionContext Engine-стратегии, а вне сборки оставляет всё с info', () => {
    const afl = compileCompositionSource(SOURCE, 1, { tenant: 'afl' })
    expect(afl.artifact?.runtimes.map(item => item.name)).toEqual(['flight', 'details'])
    const unbound = compileCompositionSource(SOURCE)
    expect(codes(unbound, 'error')).toEqual([])
    expect(codes(unbound)).toContain('composition-enabled-when-unbound')
    expect(unbound.artifact?.runtimes).toHaveLength(4)
  })

  it('activateWhen: binding, manual activation и запрет сочетания с activateOn', () => {
    const kzn = runWithSourceContext(KZN, () => compileCompositionSource(SOURCE))
    const details = kzn.artifact?.runtimes.find(item => item.name === 'details')
    expect(details?.activateWhen).toEqual({ kind: 'data', data: 'flight', path: 'selected' })
    expect(details?.effectiveActivation).toEqual({ mode: 'manual' })

    const conflict = compileCompositionSource(`defineComposition({
      runtimes: { panel: component('p').activateOn(startup()).activateWhen(fromStore('flags.on')) },
    })`)
    expect(codes(conflict, 'error')).toContain('composition-activate-when-conflict')

    const missing = compileCompositionSource(`defineComposition({
      runtimes: { panel: component('p').activateWhen(fromData('nope.x')) },
    })`)
    expect(codes(missing, 'error')).toContain('composition-binding-data-missing')

    const constant = compileCompositionSource(`defineComposition({
      runtimes: { panel: component('p').activateWhen(true) },
    })`)
    expect(codes(constant, 'warning')).toContain('composition-activate-when-static')

    const mount = compileCompositionSource(`defineComposition({
      runtimes: {
        extra: scope({ runtimes: { load: query('q') } }).activateWhen(fromStore('flags.on')),
      },
      hooks: [onMount().run('extra.load')],
    })`)
    expect(codes(mount, 'error')).toContain('composition-activate-when-mount-hook')
  })

  it('ошибки enabledWhen не зависят от выбранного фасета', () => {
    const reference = `defineComposition({
      runtimes: {
        stands: query('kzn-stands').enabledWhen(context({ tenant: 'kzn' })),
        table: component('table').withProps({ rows: fromOutput('stands', 'rows') }),
      },
    })`
    for (const context of [AFL, KZN]) {
      const result = runWithSourceContext(context, () => compileCompositionSource(reference))
      expect(codes(result, 'error')).toContain('composition-enabled-when-reference')
    }

    const output = runWithSourceContext(KZN, () => compileCompositionSource(`defineComposition({
      runtimes: { stands: query('kzn-stands').enabledWhen(context({ tenant: 'kzn' })) },
      outputs: { rows: output().fromRuntime('stands', 'rows') },
    })`))
    expect(codes(output, 'error')).toContain('composition-enabled-when-output')

    const shape = compileCompositionSource(`defineComposition({
      runtimes: {
        a: query('a').enabledWhen({ tenant: 'kzn' }),
        b: query('b').enabledWhen(context({})),
        c: query('c').enabledWhen(context({ tenant: 'kzn' })).enabledWhen(context({ stage: 'prod' })),
      },
    })`)
    expect(codes(shape, 'error')).toEqual(expect.arrayContaining([
      'composition-enabled-when-shape',
      'composition-enabled-when-empty',
      'composition-enabled-when-repeated',
    ]))

    const never = runWithSourceContext(KZN, () => compileCompositionSource(`defineComposition({
      runtimes: {
        kzn: scope({ runtimes: { afl: query('a').enabledWhen(context({ tenant: 'afl' })) } }).enabledWhen(context({ tenant: 'kzn' })),
      },
    })`))
    expect(codes(never, 'warning')).toContain('composition-enabled-when-never')
    expect(never.artifact?.runtimes).toEqual([])
  })

  it('сообщает об ошибках формы activateWhen и записей context() в enabledWhen', () => {
    const activate = compileCompositionSource(`defineComposition({
      data: { flight: store('flight-store') },
      runtimes: {
        filter: filter('flight-filter'),
        repeated: component('a').activateWhen(fromData('flight.on')).activateWhen(fromData('flight.off')),
        empty: component('b').activateWhen(),
        twice: component('c').activateWhen(fromData('flight.on'), true),
        fields: component('d').activateWhen(fromFilter('filter').fields(['from'])),
        view: component('e').activateWhen(fromData('flight.rows').dataView('local-filter')),
      },
    })`)
    expect(codes(activate, 'error')).toEqual(expect.arrayContaining([
      'composition-activate-when-repeated',
      'composition-activate-when-shape',
      'composition-activate-when-binding',
    ]))
    expect(codes(activate, 'error').filter(code => code === 'composition-activate-when-shape')).toHaveLength(2)
    expect(codes(activate, 'error').filter(code => code === 'composition-activate-when-binding')).toHaveLength(2)

    const entries = compileCompositionSource(`defineComposition({
      runtimes: {
        a: query('a').enabledWhen(context({ tenant: 1, stage: 'prod' })),
        b: query('b').enabledWhen(context({ tenant: 'kzn', tenant: 'afl' })),
      },
    })`)
    expect(codes(entries, 'error')).toEqual(expect.arrayContaining([
      'composition-enabled-when-entry',
      'composition-enabled-when-duplicate',
    ]))
  })

  it('модификаторы указываются после contextSwitch и действуют на выбранную ветку', () => {
    const source = `defineComposition({
      runtimes: {
        inspector: contextSwitch({
          default: component('inspector'),
          cases: [{ when: { tenant: 'kzn' }, use: component('inspector-kzn') }],
        }).enabledWhen(context({ stage: 'prod' })).activateWhen(fromStore('flags.inspector')),
      },
    })`
    const prod = compileCompositionSource(source, 1, { tenant: 'kzn', stage: 'prod' })
    expect(codes(prod, 'error')).toEqual([])
    expect(prod.artifact?.runtimes[0]).toMatchObject({ identity: 'inspector-kzn', enabledWhen: { stage: 'prod' }, activateWhen: { kind: 'store', key: 'flags.inspector' } })
    const dev = compileCompositionSource(source, 1, { tenant: 'kzn', stage: 'dev' })
    expect(dev.artifact?.runtimes).toEqual([])
  })
})
