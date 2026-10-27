import type { SourceContextValues } from '@/features/core/modules/source/domain/types/source-context.types'
import type { TypeSourceDefinition } from '@/features/core/modules/source/domain/types/type-source.types'

import { describe, expect, it } from 'vitest'

import { compileComponentSFC } from '@/features/core/modules/compiler/services/component-sfc/component-sfc-compile'
import { collectTypeDefinitionReferences, validateTypeDefinitionReferences } from '@/features/core/modules/compiler/services/type/type-program-validation'
import { compileCompositionSource } from '@/features/core/modules/source/services/compilers/composition-source-compile'
import { compileQuerySource } from '@/features/core/modules/source/services/compilers/query-source-compile'
import { compileStreamSource } from '@/features/core/modules/source/services/compilers/stream-source-compile'
import { compileTypeSource } from '@/features/core/modules/source/services/compilers/type-source-compile'
import { runWithSourceContext } from '@/features/core/modules/source/services/source-context'
import { resolveTypeDefinitionExtends } from '@/features/core/modules/source/services/type-extends'
import { serializeTypeSourceDocument } from '@/features/core/modules/source/services/type-source-serialize'

const AFL: SourceContextValues = { facets: { tenant: 'afl' }, config: {}, knownFacets: ['tenant'] }
const KZN: SourceContextValues = { facets: { tenant: 'kzn' }, config: {}, knownFacets: ['tenant'] }

function codes(result: { diagnostics: Array<{ code: string, severity: string }> }, severity?: string): string[] {
  return result.diagnostics.filter(item => !severity || item.severity === severity).map(item => item.code)
}

const FLIGHT_SOURCE = `defineType({
  extends: type('Base'),
  fields: {
    gate: field(contextSwitch({ default: type('Gate'), cases: [{ when: { tenant: 'kzn' }, use: type('Stand') }] })).optional(),
  },
})`

describe('type: extends и contextSwitch ссылок', () => {
  it('выбирает ветку ссылки по фасетам, сохраняя все ветки для проверки', () => {
    const afl = runWithSourceContext(AFL, () => compileTypeSource(FLIGHT_SOURCE))
    const kzn = runWithSourceContext(KZN, () => compileTypeSource(FLIGHT_SOURCE))
    expect(codes(afl, 'error')).toEqual([])
    const aflGate = afl.document?.definition.kind === 'object' ? afl.document.definition.fields[0]!.type : null
    const kznGate = kzn.document?.definition.kind === 'object' ? kzn.document.definition.fields[0]!.type : null
    expect(aflGate).toMatchObject({ kind: 'reference', identity: 'Gate' })
    expect(kznGate).toMatchObject({ kind: 'reference', identity: 'Stand' })
    expect(afl.document?.definition).toMatchObject({ kind: 'object', extends: { kind: 'reference', identity: 'Base' } })
    // Невыбранная ветка (Stand) и база участвуют в ссылках и проверке реестра.
    expect(collectTypeDefinitionReferences(afl.document!.definition).sort()).toEqual(['Base', 'Gate', 'Stand'])
    expect(validateTypeDefinitionReferences(afl.document!.definition, new Set(['Base', 'Gate'])))
      .toEqual([expect.objectContaining({ code: 'type-reference-missing', message: expect.stringContaining('Stand') })])
  })

  it('вне сборки берёт default с info и проверяет форму extends', () => {
    const unbound = compileTypeSource(FLIGHT_SOURCE)
    expect(codes(unbound)).toEqual(['source-expression-context-unbound'])
    expect(codes(compileTypeSource(`defineType({ extends: objectOf({ a: field(String) }), fields: {} })`))).toContain('type-source-extends-shape')
    expect(codes(compileTypeSource(`defineType({ extends: type('Base'), fields: [], extra: 1 })`))).toEqual(['type-source-extends-fields-shape', 'type-source-extends-property'])
    // Поле с именем extends через field(...) остаётся обычным полем.
    expect(compileTypeSource(`defineType({ extends: field(String) })`).document?.definition).toMatchObject({ fields: [{ key: 'extends' }] })
  })

  it('разворачивает цепочку extends, проверяет переопределения и циклы', () => {
    const authored: Record<string, TypeSourceDefinition | null> = {
      Root: compileTypeSource(`defineType({ id: field(ID), note: field(String).optional() })`).document!.definition,
      Base: compileTypeSource(`defineType({ extends: type('Root'), fields: { code: field(String) } })`).document!.definition,
      Loop: compileTypeSource(`defineType({ extends: type('Flight'), fields: {} })`).document!.definition,
      String: null,
    }
    const lookup = (identity: string) => authored[identity] ?? (identity in authored ? null : undefined)
    const flight = compileTypeSource(`defineType({
      extends: type('Base'),
      fields: { note: field(String), gate: field(String) },
    })`).document!.definition
    const resolved = resolveTypeDefinitionExtends(flight, lookup, 'Flight')
    expect(resolved.diagnostics).toEqual([])
    expect(resolved.definition).toMatchObject({
      kind: 'object',
      extends: { identity: 'Base' },
      fields: [
        { key: 'id', inheritedFrom: 'Root' },
        { key: 'note', optional: false },
        { key: 'code', inheritedFrom: 'Base' },
        { key: 'gate' },
      ],
    })
    expect((resolved.definition as any).fields[1].inheritedFrom).toBeUndefined()

    const incompatible = compileTypeSource(`defineType({ extends: type('Root'), fields: { id: field(Number), note: field(String).optional() } })`).document!.definition
    expect(resolveTypeDefinitionExtends(incompatible, lookup, 'X').diagnostics.map(item => item.code)).toEqual(['type-extends-field-incompatible'])
    const loop = compileTypeSource(`defineType({ extends: type('Loop'), fields: {} })`).document!.definition
    expect(resolveTypeDefinitionExtends(loop, lookup, 'Flight').diagnostics).toEqual([
      expect.objectContaining({ code: 'type-extends-cycle', message: expect.stringContaining('Flight → Loop → Flight') }),
    ])
    const primitive = compileTypeSource(`defineType({ extends: type('String'), fields: {} })`).document!.definition
    expect(resolveTypeDefinitionExtends(primitive, lookup).diagnostics.map(item => item.code)).toEqual(['type-extends-not-object'])

    // Сериализатор пишет только собственные поля и extends.
    const source = serializeTypeSourceDocument({ definition: resolved.definition! })
    expect(source).toContain(`extends: type('Base')`)
    expect(source).not.toContain('code:')
    expect(compileTypeSource(source).document?.definition).toMatchObject({ extends: { identity: 'Base' }, fields: [{ key: 'note' }, { key: 'gate' }] })
  })
})

describe('contextSwitch ссылок в Query: Type поля и DataView', () => {
  const QUERY = `defineQuery({
  kind: 'rest',
  props: defineProps({ leg: field(contextSwitch({ default: 'LegAfl', cases: [{ when: { tenant: 'kzn' }, use: type('LegKzn') }] })) }),
  request: { endpoint: 'https://ops.example.test', path: '/legs', method: 'GET' },
  outputs: {
    rows: output().from(response('rows')).dataView(contextSwitch({
      default: 'rows-afl',
      cases: [{ when: { tenant: 'kzn' }, use: dataView('rows-kzn') }],
    })),
  },
})`

  it('выбирает Type поля и DataView по фасетам, ветки остаются для проверки', () => {
    const afl = runWithSourceContext(AFL, () => compileQuerySource(QUERY))
    const kzn = runWithSourceContext(KZN, () => compileQuerySource(QUERY))
    expect(codes(afl, 'error')).toEqual([])
    expect(afl.artifact?.props[0]).toMatchObject({ type: 'LegAfl', typeVariants: [{ identity: 'LegAfl' }, { identity: 'LegKzn' }] })
    expect(kzn.artifact?.props[0]).toMatchObject({ type: 'LegKzn' })
    expect(afl.artifact?.outputs[0]?.dataViews).toEqual([{
      kind: 'external',
      identity: 'rows-afl',
      contextVariants: [{ kind: 'external', identity: 'rows-afl' }, { kind: 'external', identity: 'rows-kzn' }],
    }])
    expect(kzn.artifact?.outputs[0]?.dataViews[0]).toMatchObject({ identity: 'rows-kzn' })
  })

  it('отклоняет ветку, которая не является ссылкой', () => {
    const result = runWithSourceContext(AFL, () => compileQuerySource(QUERY.replace(`use: dataView('rows-kzn')`, 'use: 42').replace(`use: type('LegKzn')`, 'use: 42')))
    expect(codes(result, 'error')).toEqual(expect.arrayContaining(['source-field-type', 'source-reference-context-switch-branch']))
  })
})

describe('contextSwitch в привязках портов SFC', () => {
  const child = compileComponentSFC(`<script setup lang="ts">
interface UpdateInput { legId: String }
const ports = definePorts({
  require: {
    update: query<UpdateInput, void>({ default: 'update-default' }),
  },
})
</script>
<template><Text>x</Text></template>`, {
    resolvePortProvider: identity => ({ kind: 'query', identity, active: true, outputs: [], inputs: [{ name: 'legId', type: 'String', optional: false }] }),
  })
  const providers: Record<string, any> = {
    'update-afl': { kind: 'query', identity: 'update-afl', active: true, outputs: [], inputs: [{ name: 'legId', type: 'String', optional: false }] },
    'update-kzn': { kind: 'query', identity: 'update-kzn', active: true, outputs: [], inputs: [{ name: 'legId', type: 'String', optional: false }] },
    'update-bad': { kind: 'query', identity: 'update-bad', active: true, outputs: [], inputs: [{ name: 'flightId', type: 'Number', optional: false }] },
  }
  const compileParent = (binding: string) => compileComponentSFC(`<template>
  <Leg.Editor :update="${binding}" />
</template>`, {
    resolveComponentTag: () => 'leg-editor',
    resolveComponentPortManifest: () => child.ir!.script.ports,
    resolvePortProvider: identity => providers[identity] ?? null,
  })
  const SWITCH = `contextSwitch({ default: query('update-afl'), cases: [{ when: { tenant: 'kzn' }, use: query('update-kzn') }] })`

  it('выбирает provider по фасетам и добавляет зависимости всех веток', () => {
    const afl = runWithSourceContext(AFL, () => compileParent(SWITCH))
    const kzn = runWithSourceContext(KZN, () => compileParent(SWITCH))
    expect(codes(afl, 'error')).toEqual([])
    expect(afl.ir?.template.roots[0]).toMatchObject({ portBindings: [{ port: 'update', kind: 'query', identity: 'update-afl' }] })
    expect(kzn.ir?.template.roots[0]).toMatchObject({ portBindings: [{ port: 'update', kind: 'query', identity: 'update-kzn' }] })
    expect(afl.dependencies.queries).toEqual(expect.arrayContaining(['update-afl', 'update-kzn']))
    expect(codes(compileParent(SWITCH))).toContain('source-expression-context-unbound')
  })

  it('проверяет contract, kind и наличие provider в каждой ветке', () => {
    const contract = runWithSourceContext(AFL, () => compileParent(SWITCH.replace('update-kzn', 'update-bad')))
    expect(codes(contract, 'error')).toEqual(['sfc-template-query-port-contract'])
    expect((contract.ir?.template.roots[0] as any).portBindings).toBeUndefined()
    expect(codes(runWithSourceContext(AFL, () => compileParent(SWITCH.replace(`query('update-kzn')`, `action('update-kzn')`))), 'error')).toEqual(['sfc-template-port-binding-kind'])
    expect(codes(runWithSourceContext(AFL, () => compileParent(SWITCH.replace('update-kzn', 'missing'))), 'error')).toEqual(['sfc-template-port-provider-missing'])
    expect(codes(runWithSourceContext(AFL, () => compileParent(`contextSwitch({ cases: [] })`)), 'error')).toEqual(['source-expression-context-switch-default-required'])
  })
})

describe('решения координатора по W3', () => {
  it('предупреждает о неизвестном фасете в context(), when и enabledWhen', () => {
    const query = runWithSourceContext(AFL, () => compileQuerySource(`defineQuery({
  kind: 'rest',
  request: {
    endpoint: 'https://ops.example.test',
    path: '/x',
    method: 'GET',
    headers: {
      'X-A': toString(context({ tenat: 'kzn' })),
      'X-B': contextSwitch({ default: 'a', cases: [{ when: { stage: 'prod' }, use: 'b' }] }),
    },
  },
  outputs: { raw: output().from(response()) },
})`))
    expect(codes(query, 'warning')).toEqual(['source-expression-facet-unknown', 'source-expression-facet-unknown'])
    const composition = runWithSourceContext(AFL, () => compileCompositionSource(`defineComposition({
  runtimes: { flight: query('flight').enabledWhen(context({ tenat: 'kzn' })) },
})`))
    expect(codes(composition, 'warning')).toContain('source-expression-facet-unknown')
    // Без списка фасетов (редактор) предупреждения нет.
    expect(codes(runWithSourceContext({ facets: {}, config: {} }, () => compileCompositionSource(`defineComposition({
  runtimes: { flight: query('flight').enabledWhen(context({ tenat: 'kzn' })) },
})`)), 'warning')).toEqual([])
  })

  it('объясняет onMount для runtime с activateWhen без совета activateOn', () => {
    const result = compileCompositionSource(`defineComposition({
  data: { flags: store('flags') },
  runtimes: { flight: query('flight').activateWhen(fromData('flags.on')) },
  hooks: [onMount().run('flight')],
})`)
    const diagnostic = result.diagnostics.find(item => item.code === 'composition-hook-manual-target')
    expect(diagnostic?.message).toContain('activateWhen')
    expect(diagnostic?.message).not.toContain('activateOn(startup())')
  })

  it('диагностирует цикл фрагментов GraphQL без схемы', () => {
    const query = compileQuerySource(`defineQuery({
  kind: 'graphql',
  request: {
    endpoint: 'https://ops.example.test/graphql',
    document: gql\`query Flight { flight { ...A } }\`,
    fragments: {
      A: gql\`fragment A on Flight { id ...B }\`,
      B: contextSwitch({ default: gql\`fragment B on Flight { gate }\`, cases: [{ when: { tenant: 'kzn' }, use: gql\`fragment B on Flight { stand ...A }\` }] }),
    },
  },
  outputs: { raw: output().from(response()) },
})`)
    expect(query.diagnostics).toContainEqual(expect.objectContaining({
      code: 'query-source-graphql-fragment-cycle',
      message: expect.stringContaining('A → B → A'),
    }))
    const stream = compileStreamSource(`defineStream({
  transport: graphqlSse({
    url: 'https://ops.example.test/graphql/stream',
    document: gql\`subscription Changes { changes { ...A } }\`,
    fragments: { A: gql\`fragment A on Change { id ...A }\` },
  }),
})`)
    expect(codes(stream, 'error')).toContain('stream-graphql-fragment-cycle')
  })
})
