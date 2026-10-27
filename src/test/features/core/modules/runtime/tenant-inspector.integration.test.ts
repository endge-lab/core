import type { AxiosRequestConfig } from 'axios'
import type { ComponentSFCRuntimeHost } from '@/features/core/modules/runtime/hosts/ComponentSFCRuntimeHost'

import { Raph } from '@raphy-js/raph'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Endge } from '@/features/core/kernel/endge'
import {
  createTenantInspectorBundle,
  TENANT_INSPECTOR_FLIGHT,
  TENANT_INSPECTOR_GRAPHQL_ENDPOINT,
} from '@/test/fixtures/tenant-inspector-bundle'

// Поддельный GraphQL-сервер супермножества: отдаёт только поля, запрошенные выбранным фрагментом.
const server = vi.hoisted(() => ({ requests: [] as Array<{ url: string, headers: Record<string, unknown>, body: { query: string, variables: Record<string, unknown> } }> }))

vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>()
  const create = (...args: Parameters<typeof actual.default.create>) => {
    const instance = actual.default.create(...args)
    instance.defaults.adapter = async (config: AxiosRequestConfig) => {
      const body = typeof config.data === 'string' ? JSON.parse(config.data) : config.data
      server.requests.push({ url: String(config.url), headers: { ...(config.headers as Record<string, unknown>) }, body })
      return { data: { data: { flight: projectFlight(body.query) } }, status: 200, statusText: 'OK', headers: {}, config, request: {} } as never
    }
    return instance
  }
  return { ...actual, default: Object.assign(Object.create(actual.default), actual.default, { create }), create }
})

function projectFlight(query: string): Record<string, unknown> {
  const fragment = /fragment FlightFields on Flight \{([\s\S]*)\}/.exec(query)?.[1] ?? ''
  const requested = new Set(fragment.replace(/\{[^}]*\}/g, ' ').split(/\s+/).filter(Boolean))
  return Object.fromEntries(Object.entries(TENANT_INSPECTOR_FLIGHT).filter(([key]) => requested.has(key)))
}

async function bootTenant(tenant: string): Promise<void> {
  vi.spyOn(Endge.bridge, 'start').mockImplementation(() => {})
  await Endge.boot({
    dataProvider: 'bundle',
    scope: { workspaceIdentity: 'tenant-inspector' },
    vars: {},
    bundleSource: createTenantInspectorBundle(),
    context: { facets: { tenant } },
  })
  // Workspace примера хранится в режиме development (mock); тест проверяет живой GraphQL transport.
  Endge.context.setDataMode('live')
}

function readComponentInput(host: ComponentSFCRuntimeHost, name: string): unknown {
  const input = host.getInputSource()
  if (input?.kind === 'raph' && input.bindings[name]) {
    return Raph.get(input.bindings[name]!.path)
  }
  return input?.props?.[name]
}

async function mountInspector() {
  const session = await Endge.runtime.composition.mount('flight-inspector')
  await vi.waitFor(() => expect(server.requests).toHaveLength(1))
  const inspector = session.host.getChild('inspector') as unknown as ComponentSFCRuntimeHost
  await vi.waitFor(() => expect(readComponentInput(inspector, 'model')).toBeTruthy())
  return { session, inspector }
}

describe('сквозной пример АФЛ/КЗН: инспектор рейса по тенантам', () => {
  afterEach(async () => {
    server.requests.length = 0
    Endge.context.clearDataModeOverride()
    await Endge.reset()
    vi.restoreAllMocks()
  })

  it('собирает переносимый bundle без ошибок для обоих тенантов', async () => {
    for (const tenant of ['afl', 'kzn']) {
      await bootTenant(tenant)
      const failed = Endge.program.getArtifacts()
        .filter(artifact => artifact.status !== 'valid' || artifact.diagnostics.some(item => item.severity === 'error'))
        .map(artifact => `${artifact.ref.entityType}:${artifact.ref.identity}`)
      expect(failed).toEqual([])
      expect(Endge.context.getFacetSelections()).toEqual({ tenant })
      expect(Endge.configuration.current.values.inspector?.title).toBe(tenant === 'kzn' ? 'Инспектор КЗН' : 'Инспектор рейса')
      await Endge.reset()
    }
  })

  it('передаёт редактору контекст текущего boot для проверки Source', async () => {
    expect(Endge.source.currentSourceContext()).toBeNull()
    await bootTenant('kzn')
    const sourceContext = Endge.source.currentSourceContext()
    expect(sourceContext).toMatchObject({ facets: { tenant: 'kzn' }, knownFacets: ['tenant'] })
    const source = `defineDataView({ mode: 'projection', output: { tenant: facet('tenant'), stage: facet('stage') } })`
    const codes = (context?: typeof sourceContext) => (Endge.source.validate('data-view', source, context ? { sourceContext: context } : undefined).diagnostics ?? [])
      .map(item => (item as { code: string }).code)
    expect(codes()).toContain('source-expression-context-unbound')
    expect(codes(sourceContext)).not.toContain('source-expression-context-unbound')
    expect(codes(sourceContext)).toContain('source-expression-facet-unknown')
  })

  it('аФЛ: фрагмент с выходом, схема АФЛ, без казанской ветки Composition', async () => {
    await bootTenant('afl')
    const { session, inspector } = await mountInspector()

    const [request] = server.requests
    expect(request!.url).toBe(TENANT_INSPECTOR_GRAPHQL_ENDPOINT)
    expect(request!.headers['X-Tenant']).toBe('afl')
    expect(request!.body.variables).toEqual({ id: 'SU1402' })
    expect(request!.body.query).toContain('gate')
    expect(request!.body.query).not.toContain('stand')

    expect(readComponentInput(inspector, 'model')).toEqual({
      tenant: 'afl',
      title: 'Инспектор рейса SU 1402',
      sections: [
        {
          title: 'Рейс',
          fields: [
            { label: 'Номер', format: 'text', value: 'SU 1402' },
            { label: 'Статус', format: 'badge', value: 'Посадка' },
            { label: 'Вылет', format: 'text', value: '2026-10-26T18:40:00+03:00' },
          ],
        },
        {
          title: 'Перрон',
          fields: [
            { label: 'Выход', format: 'text', value: 'B7' },
            { label: 'КВС', format: 'text', value: 'Иванов' },
          ],
        },
      ],
    })
    expect(session.host.getChild('handling')).toBeNull()
    expect(inspector.getDiagnostics().filter(item => item.severity === 'error')).toEqual([])
    await session.unmount()
  })

  it('кЗН: казанский фрагмент и Type FlightKzn, схема КЗН, компонент обслуживания', async () => {
    await bootTenant('kzn')
    const { session, inspector } = await mountInspector()

    const [request] = server.requests
    expect(request!.headers['X-Tenant']).toBe('kzn')
    expect(request!.body.query).toContain('stand handlingAgent')
    expect(request!.body.query).not.toMatch(/\bgate\b/)

    expect(readComponentInput(inspector, 'model')).toEqual({
      tenant: 'kzn',
      title: 'Инспектор КЗН SU 1402',
      sections: [
        {
          title: 'Рейс',
          fields: [
            { label: 'Номер', format: 'text', value: 'SU 1402' },
            { label: 'Статус', format: 'badge', value: 'Посадка' },
          ],
        },
        {
          title: 'Наземное обслуживание',
          fields: [
            { label: 'Стоянка', format: 'badge', value: 'S12' },
            { label: 'Агент', format: 'text', value: 'Казань Хендлинг' },
            { label: 'Второй пилот', format: 'text', value: 'Петров' },
          ],
        },
      ],
    })
    const handling = session.host.getChild('handling') as unknown as ComponentSFCRuntimeHost
    expect(handling).not.toBeNull()
    await vi.waitFor(() => expect(readComponentInput(handling, 'flight')).toMatchObject({ stand: 'S12', handlingAgent: 'Казань Хендлинг' }))

    const flightType = Endge.program.getArtifacts().find(artifact => artifact.ref.entityType === 'type' && artifact.ref.identity === 'FlightKzn')
    expect((flightType?.payload as { definition?: { fields?: Array<{ key: string }> } }).definition?.fields?.map(field => field.key))
      .toEqual(['id', 'number', 'status', 'departure', 'gate', 'crew', 'stand', 'handlingAgent'])
    await session.unmount()
  })
})
