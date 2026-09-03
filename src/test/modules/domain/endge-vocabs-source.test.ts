import { Raph } from '@endge/raph'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Endge } from '@/kernel/endge'
import { RConverter } from '@/modules/domain/entities/RConverter'
import { REnvironment } from '@/modules/domain/entities/REnvironment'
import { RMock } from '@/modules/domain/entities/RMock'
import { RProject } from '@/modules/domain/entities/RProject'
import { RTenant } from '@/modules/domain/entities/RTenant'
import { RVocabs } from '@/modules/domain/entities/RVocabs'
import { TEST_ENDGE_WORKSPACE } from '@/test/fixtures/endge-workspace'

describe('source-first Vocab', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    Endge.program.clear()
    Endge.domain.reset()
    Endge.mock.reset()
    Endge.configuration.reset()
    Endge.workspace.reset()
    Raph.delete('vocabs.airlines')
    Raph.delete('vocabs.airlines-payload')
  })

  it('compiles Payload, Mock dot-path and ordered transforms', () => {
    const result = Endge.source.compile('vocab', `
defineVocab({
  provider: payload({
    baseUrl: env('ENDPOINT_VOCABS_SERVICE'),
    collection: 'airlines-payload',
    auth: { mode: 'inherit' },
  }),
  mock: mock('aodb-fixtures').path('lookups.airlines.0.items'),
  outputs: {
    items: output()
      .from(response())
      .dataView('normalize-airlines')
      .convert('normalize-code', { uppercase: true }),
  },
})
`)

    expect(result.ok).toBe(true)
    expect(result.artifact).toMatchObject({
      sourceVersion: 1,
      provider: { kind: 'payload', baseUrl: { kind: 'env', name: 'ENDPOINT_VOCABS_SERVICE' }, collection: 'airlines-payload' },
      mock: { identity: 'aodb-fixtures', path: 'lookups.airlines.0.items' },
      outputs: [{
        key: 'items',
        transforms: [
          { kind: 'data-view', ref: { kind: 'external', identity: 'normalize-airlines' } },
          { kind: 'converter', identity: 'normalize-code', options: { uppercase: true } },
        ],
      }],
    })
  })

  it('uses [] in mock mode without touching Payload or auth when mock is absent', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const vocab = makeVocab(`
defineVocab({
  provider: payload({
    baseUrl: 'https://payload.invalid',
    collection: 'airlines-payload',
    auth: { mode: 'profile', profile: 'keycloak-default' },
  }),
  outputs: { items: output().from(response()) },
})
`)
    Endge.domain.addVocab(vocab)
    prepareCompilerContext()
    Endge.program.beginCompile('test')
    publishVocabArtifact(vocab)

    await expect(Endge.vocabs.loadVocab('airlines', { dataMode: 'mock', throwOnError: true })).resolves.toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(Raph.get('vocabs.airlines')).toEqual([])
    expect(Raph.get('vocabs.airlines-payload')).toEqual([])
  })

  it('reads explicit Mock dot-path and passes Converter options once for the whole value', async () => {
    const converter = new RConverter()
    converter.id = 3
    converter.identity = 'append-item'
    converter.name = converter.identity
    const handler = vi.fn((value: unknown, options?: Record<string, unknown>) => [
      ...(value as unknown[]),
      options?.tail,
    ])
    converter.setCustom(handler)
    Endge.domain.addConverter(converter)

    const mock = new RMock()
    mock.id = 2
    mock.identity = 'aodb-fixtures'
    mock.name = mock.identity
    mock.displayName = mock.identity
    mock.contentType = 'application/json'
    mock.source = JSON.stringify({ lookups: { airlines: [{ code: 'SU' }] } })
    Endge.domain.addMock(mock)

    const vocab = makeVocab(`
defineVocab({
  mock: mock('aodb-fixtures').path('lookups.airlines'),
  outputs: {
    items: output().from(response()).convert('append-item', { tail: 'done' }),
  },
})
`)
    Endge.domain.addVocab(vocab)
    Endge.program.beginCompile('test')
    publishVocabArtifact(vocab)

    await expect(Endge.vocabs.loadVocab('airlines', { dataMode: 'mock', throwOnError: true }))
      .resolves
      .toEqual([{ code: 'SU' }, 'done'])
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith([{ code: 'SU' }], { tail: 'done' })
  })

  it('aggregates paginated Payload docs before applying outputs', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ docs: [{ code: 'SU' }], hasNextPage: true, nextPage: 2 }))
      .mockResolvedValueOnce(response({ docs: [{ code: 'FV' }], totalPages: 2 }))
    const vocab = makeVocab(`
defineVocab({
  provider: payload({
    baseUrl: 'https://payload.example',
    collection: 'airlines-payload',
    auth: { mode: 'none' },
  }),
  outputs: { items: output().from(response()) },
})
`)
    Endge.domain.addVocab(vocab)
    Endge.program.beginCompile('test')
    publishVocabArtifact(vocab)

    await expect(Endge.vocabs.loadVocab('airlines', { dataMode: 'live', throwOnError: true }))
      .resolves
      .toEqual([{ code: 'SU' }, { code: 'FV' }])
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('https://payload.example/airlines-payload?limit=1000&page=1')
    expect(fetchSpy.mock.calls[1]?.[0]).toBe('https://payload.example/airlines-payload?limit=1000&page=2')
  })

  it('reports a missing explicit Mock path', async () => {
    const mock = new RMock()
    mock.id = 4
    mock.identity = 'fixtures'
    mock.name = mock.identity
    mock.displayName = mock.identity
    mock.source = '{}'
    Endge.domain.addMock(mock)
    const vocab = makeVocab(`defineVocab({ mock: mock('fixtures').path('lookups.airlines'), outputs: { items: output().from(response()) } })`)
    Endge.domain.addVocab(vocab)
    prepareCompilerContext()
    Endge.program.beginCompile('test')
    const compiled = Endge.compiler.buildVocab(vocab)
    expect(compiled.status).toBe('error')
    expect(compiled.diagnostics).toContainEqual(expect.objectContaining({ code: 'vocab-mock-path-missing' }))
    publishVocabArtifact(vocab)

    await expect(Endge.vocabs.loadVocab('airlines', { dataMode: 'mock', throwOnError: true }))
      .rejects
      .toThrow('путь "lookups.airlines" отсутствует')
  })

  it('rejects async Converter handlers', () => {
    const converter = new RConverter()
    converter.identity = 'async-converter'
    converter.setCustom(async value => value)

    expect(() => converter.convert([])).toThrow('Async converter "async-converter" is not supported')
  })

  it('patches Mock binding without rewriting the rest of source', () => {
    const source = `defineVocab({\n  // author note\n  outputs: { items: output().from(response()) },\n})\n`
    const patched = Endge.source.patch('vocab', source, {
      mock: { identity: 'fixtures', path: 'airlines' },
    })

    expect(patched.ok).toBe(true)
    expect(patched.source).toContain('// author note')
    expect(patched.source).toContain(`mock: mock('fixtures').path('airlines'),`)
  })
})

function makeVocab(source: string): RVocabs {
  const vocab = new RVocabs()
  vocab.id = 1
  vocab.identity = 'airlines'
  vocab.name = vocab.identity
  vocab.displayName = vocab.identity
  vocab.source = source
  vocab.sourceVersion = 1
  return vocab
}

function prepareCompilerContext(): void {
  Endge.workspace.apply(TEST_ENDGE_WORKSPACE)
  Endge.domain.addProject(RProject.fromPlain({ id: 101, identity: 'project', name: 'Project' }))
  Endge.domain.addEnvironment(REnvironment.fromPlain({ id: 102, identity: 'environment', name: 'Environment' }))
  const tenant = new RTenant()
  tenant.id = 103
  tenant.identity = 'tenant'
  tenant.name = 'Tenant'
  tenant.code = 'tenant'
  Endge.domain.addTenant(tenant)
  Endge.configuration.build({
    dataProvider: 'plain',
    scope: {},
    vars: {},
    context: { projectIdentity: 'project', environmentIdentity: 'environment', tenantIdentity: 'tenant' },
  })
}

function publishVocabArtifact(vocab: RVocabs): void {
  const result = Endge.source.compile('vocab', vocab.source)
  if (!result.ok || !result.artifact) {
    throw new Error(result.message ?? 'Vocab source did not compile.')
  }
  Endge.program.addArtifact({
    ref: { entityType: 'vocab', id: vocab.id, identity: vocab.identity },
    sourceHash: 'test',
    compilerVersion: 'test',
    status: 'valid',
    diagnostics: [],
    dependencies: [],
    capabilities: ['compilable', 'runnable', 'data-provider'],
    metadata: { self: {}, nodes: [] },
    payload: result.artifact,
  })
}

function response(value: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => value,
  } as Response
}
