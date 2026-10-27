import type { AxiosRequestConfig } from 'axios'
import type { EndgeDomainBundle } from '@/features/core/modules/domain/types/document/domain-export.type'
import type { ComponentSFCProgramPayload, ProgramArtifact } from '@/features/core/modules/program/domain/types/program.types'
import type { ComponentSFCRuntimeHost } from '@/features/core/modules/runtime/hosts/ComponentSFCRuntimeHost'
import type { EndgeUIJsonSnapshot, EndgeUINode, EndgeUIPatch } from '@/features/core/modules/ui/domain/types/endge-ui-json.types'

import { Raph } from '@raphy-js/raph'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Endge } from '@/features/core/kernel/endge'
import { compileComponentSFC } from '@/features/core/modules/compiler/services/component-sfc/component-sfc-compile'
import { RComponentSFC } from '@/features/core/modules/domain/entities/RComponentSFC'
import { ComponentSFCRuntimeHost as SFCHost } from '@/features/core/modules/runtime/hosts/ComponentSFCRuntimeHost'
import { EndgeUIJsonAdapter, mountEndgeUIJson } from '@/features/core/modules/ui/adapters/json/endge-ui-json-adapter'
import { applyEndgeUIPatch } from '@/features/core/modules/ui/adapters/json/endge-ui-json-patch'
import { validateEndgeUIJson } from '@/features/core/modules/ui/adapters/json/endge-ui-json.schema'
import { ENDGE_UI_JSON_ADAPTER_ID } from '@/features/core/modules/ui/domain/types/endge-ui-json.types'
import { createEndgeUIDomHost } from '@/test/examples/endge-ui-json-dom-host'
import { createTenantInspectorBundle, TENANT_INSPECTOR_FLIGHT } from '@/test/fixtures/tenant-inspector-bundle'

// Поддельный GraphQL-сервер супермножества (как в интеграционном тесте W5).
const server = vi.hoisted(() => ({ requests: [] as unknown[] }))

vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>()
  const create = (...args: Parameters<typeof actual.default.create>) => {
    const instance = actual.default.create(...args)
    instance.defaults.adapter = async (config: AxiosRequestConfig) => {
      const body = typeof config.data === 'string' ? JSON.parse(config.data) : config.data
      server.requests.push(body)
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

// Пример W5 плюс событие клика по заголовку секции, объявленное как публичный порт.
function createBundle(): EndgeDomainBundle {
  const bundle = createTenantInspectorBundle()
  const components = bundle.documents.components as Array<{ identity: string, source: string }>
  const inspector = components.find(item => item.identity === 'flight-inspector')!
  inspector.source = String(inspector.source)
    .replace('}>()\n</script>', '}>()\nconst ports = definePorts({ emits: { sectionSelected: event<{ title: string }>() } })\n</script>')
    .replace('<Text weight="600">{{ section.title }}</Text>', '<Text weight="600" @click="emit(\'sectionSelected\', { title: section.title })">{{ section.title }}</Text>')
  return bundle
}

async function bootTenant(tenant: string): Promise<void> {
  vi.spyOn(Endge.bridge, 'start').mockImplementation(() => {})
  await Endge.boot({
    dataProvider: 'bundle',
    scope: { workspaceIdentity: 'tenant-inspector' },
    vars: {},
    bundleSource: createBundle(),
    context: { facets: { tenant } },
  })
  Endge.context.setDataMode('live')
}

function readInput(host: ComponentSFCRuntimeHost, name: string): unknown {
  const input = host.getInputSource()
  return input?.kind === 'raph' && input.bindings[name] ? Raph.get(input.bindings[name]!.path) : input?.props?.[name]
}

async function mountInspector() {
  const session = await Endge.runtime.composition.mount('flight-inspector')
  const inspector = session.host.getChild('inspector') as unknown as ComponentSFCRuntimeHost
  await vi.waitFor(() => expect(readInput(inspector, 'model')).toBeTruthy())
  return { session, inspector }
}

function flatten(nodes: EndgeUINode[]): EndgeUINode[] {
  return nodes.flatMap(node => [node, ...flatten(node.children)])
}

function textOf(node: EndgeUINode): string {
  return node.text ?? node.children.map(textOf).join('')
}

// Компактная проекция для сравнения: тип, текст листьев и props, важные для примера.
function outline(nodes: EndgeUINode[]): unknown[] {
  return nodes.map(node => node.type === '#text'
    ? node.text
    : {
        [node.type]: node.children.every(child => child.type === '#text') ? textOf(node) : outline(node.children),
        ...(node.props.tone ? { tone: node.props.tone } : {}),
      })
}

function expectValidSnapshot(snapshot: EndgeUIJsonSnapshot): void {
  expect(validateEndgeUIJson(snapshot, 'snapshot')).toEqual([])
  const ids = flatten(snapshot.roots).map(node => node.id)
  expect(new Set(ids).size).toBe(ids.length)
}

describe('jSON UI endge-ui/v1 на примере АФЛ/КЗН', () => {
  afterEach(async () => {
    server.requests.length = 0
    Endge.context.clearDataModeOverride()
    await Endge.reset()
    vi.restoreAllMocks()
  })

  it('строит снимок инспектора для обоих тенантов с развёрнутыми циклами и условиями', async () => {
    const outlines: Record<string, unknown> = {}
    for (const tenant of ['afl', 'kzn']) {
      await bootTenant(tenant)
      const { session, inspector } = await mountInspector()
      const ui = mountEndgeUIJson(inspector)
      const snapshot = ui.snapshot()
      expectValidSnapshot(snapshot)
      expect(snapshot).toMatchObject({ format: 'endge-ui/v1', revision: 1, component: 'flight-inspector' })
      expect(snapshot.markers).toBeUndefined()
      outlines[tenant] = outline(snapshot.roots)

      const root = snapshot.roots[0]!
      expect(root).toMatchObject({ type: 'Flex', props: { col: true, gap: '3' } })
      const sections = root.children.filter(node => node.id.includes('['))
      expect(sections.map(node => node.id)).toEqual(tenant === 'afl'
        ? [`${sections[0]!.id.split('[')[0]}[Рейс]`, `${sections[0]!.id.split('[')[0]}[Перрон]`]
        : [`${sections[0]!.id.split('[')[0]}[Рейс]`, `${sections[0]!.id.split('[')[0]}[Наземное обслуживание]`])
      // Узлы с событиями: заголовок секции.
      expect(flatten(snapshot.roots).filter(node => node.events?.length).map(node => [textOf(node), node.events]))
        .toEqual(sections.map(section => [textOf(section.children[0]!), ['click']]))

      if (tenant === 'kzn') {
        const handling = session.host.getChild('handling') as unknown as ComponentSFCRuntimeHost
        await vi.waitFor(() => expect(readInput(handling, 'flight')).toBeTruthy())
        const handlingUi = mountEndgeUIJson(handling)
        expectValidSnapshot(handlingUi.snapshot())
        expect(outline(handlingUi.snapshot().roots)).toEqual([{ Flex: [{ Text: 'Стоянка' }, { Badge: 'S12', tone: 'info' }, { Text: 'Казань Хендлинг' }] }])
        handlingUi.unmount()
      }
      ui.unmount()
      await session.unmount()
      await Endge.reset()
    }

    const field = (label: string, value: string, badge = false) => ({ Flex: [{ Text: label }, badge ? { Badge: value, tone: 'warning' } : { Text: value }] })
    expect(outlines.afl).toEqual([{
      Flex: [
        { Flex: [{ Text: 'Инспектор рейса SU 1402' }, { Badge: 'afl', tone: 'info' }] },
        { Flex: [{ Text: 'Рейс' }, field('Номер', 'SU 1402'), field('Статус', 'Посадка', true), field('Вылет', '2026-10-26T18:40:00+03:00')] },
        { Flex: [{ Text: 'Перрон' }, field('Выход', 'B7'), field('КВС', 'Иванов')] },
      ],
    }])
    expect(outlines.kzn).toEqual([{
      Flex: [
        { Flex: [{ Text: 'Инспектор КЗН SU 1402' }, { Badge: 'kzn', tone: 'info' }] },
        { Flex: [{ Text: 'Рейс' }, field('Номер', 'SU 1402'), field('Статус', 'Посадка', true)] },
        { Flex: [{ Text: 'Наземное обслуживание' }, field('Стоянка', 'S12', true), field('Агент', 'Казань Хендлинг'), field('Второй пилот', 'Петров')] },
      ],
    }])
  })

  it('публикует патч после изменения данных и передаёт dispatch в порт Event', async () => {
    await bootTenant('afl')
    const { session, inspector } = await mountInspector()
    const ui = mountEndgeUIJson(inspector)
    const before = ui.snapshot()
    const patches: EndgeUIPatch[] = []
    ui.subscribe(patch => patches.push(patch))

    const input = inspector.getInputSource()
    expect(input?.kind).toBe('raph')
    const path = input?.kind === 'raph' ? input.bindings.model!.path : ''
    const model = structuredClone(Raph.get(path)) as { title: string, sections: Array<{ title: string, fields: Array<{ label: string, value: string }> }> }
    model.title = 'Инспектор рейса SU 1403'
    model.sections[0]!.fields[1]!.value = 'Вылетел'
    Raph.set(path, model)

    await vi.waitFor(() => expect(patches).toHaveLength(1))
    const [patch] = patches
    expect(validateEndgeUIJson(patch, 'patch')).toEqual([])
    expect(patch).toMatchObject({ format: 'endge-ui/v1', baseRevision: 1, revision: 2 })
    // Структура не изменилась: только два текстовых узла получили новый текст.
    expect(patch!.ops.map(op => op.op)).toEqual(['update', 'update'])
    expect(patch!.ops.map(op => op.op === 'update' ? op.set?.text : null)).toEqual(['Инспектор рейса SU 1403', 'Вылетел'])
    expect(applyEndgeUIPatch(before, patch!)).toEqual(ui.snapshot())

    // Удаление секции даёт операцию children по ссылкам на сохранённые узлы.
    model.sections = [model.sections[1]!]
    Raph.set(path, structuredClone(model))
    await vi.waitFor(() => expect(patches).toHaveLength(2))
    expect(patches[1]!.ops).toEqual([{ op: 'children', id: before.roots[0]!.id, children: [{ ref: before.roots[0]!.children[0]!.id }, { ref: before.roots[0]!.children[2]!.id }] }])
    expect(applyEndgeUIPatch(applyEndgeUIPatch(before, patch!), patches[1]!)).toEqual(ui.snapshot())

    const received: unknown[] = []
    inspector.onEventPort('sectionSelected', occurrence => received.push(occurrence.payload))
    const title = flatten(ui.snapshot().roots).find(node => node.events?.includes('click'))!
    expect(await ui.dispatch(title.id, 'click', { x: 1, y: 2 })).toEqual({ handled: true })
    expect(received).toEqual([{ title: 'Перрон' }])
    expect(await ui.dispatch(title.id, 'keydown', {})).toEqual({ handled: false, reason: 'unknown-event' })
    expect(await ui.dispatch('missing', 'click', {})).toEqual({ handled: false, reason: 'unknown-node' })

    ui.unmount()
    expect(await ui.dispatch(title.id, 'click', {})).toEqual({ handled: false, reason: 'unmounted' })
    await session.unmount()
  })

  it('переносит Table, Editable, форматирование, вложенный Component и EndgeCSS', async () => {
    await bootTenant('afl')
    // JSON-адаптер регистрируется при boot автоматически и не становится активным.
    expect(Endge.uiRegistry.adapters.get(ENDGE_UI_JSON_ADAPTER_ID)?.id).toBe(EndgeUIJsonAdapter.id)
    expect(Endge.uiRegistry.adapters.active?.id).not.toBe(ENDGE_UI_JSON_ADAPTER_ID)
    // Повторная регистрация того же объекта идемпотентна; другой объект с тем же id — ошибка.
    expect(Endge.uiRegistry.adapters.register(EndgeUIJsonAdapter)).toBe(Endge.uiRegistry.adapters.get(ENDGE_UI_JSON_ADAPTER_ID))
    expect(() => Endge.uiRegistry.adapters.register({ ...EndgeUIJsonAdapter })).toThrow(/already registered/)
    const adapter = Endge.uiRegistry.adapters.require({ id: ENDGE_UI_JSON_ADAPTER_ID, renderer: 'json', requiredRootKeys: ['sfc-runtime'] })
    expect(adapter.roots?.['sfc-runtime']).toBe(mountEndgeUIJson)

    const child = compileComponentSFC(`<script setup lang="ts">
defineProps<{ label: string }>()
</script>
<template><Badge tone="info">{{ label }}</Badge></template>`)
    const showcase = compileComponentSFC(`<script setup lang="ts">
defineProps<{ rows: Array<{ id: number, status: string, load: number, at: string }> }>()
const ports = definePorts({ emits: { edited: event<{ id: number, patch: Record<string, unknown> }>() } })
</script>
<template>
  <Box class="card" p="2">
    <Number :value="1234.5" decimals="1" suffix=" т" />
    <DateTime value="2026-10-26T15:40:00Z" format="HH:mm" timezone="UTC" />
    <Component is="crew" label="КВС" />
    <Table :rows="rows" row-key="id">
      <Column key="status" title="Статус">
        <Text :value="value" editable edit-on="dblclick" @edited="emit('edited', { id: rowKey, patch: { [columnKey]: event('value') } })">{{ value }}</Text>
      </Column>
      <Column key="load" title="Загрузка" width="120"><Number :value="value" /></Column>
    </Table>
  </Box>
</template>
<style lang="endgecss" scoped>
.card { gap: 8px; }
</style>`)
    expect(showcase.diagnostics.filter(item => item.severity === 'error')).toEqual([])
    const artifacts: Record<string, ProgramArtifact<ComponentSFCProgramPayload>> = {
      'json-showcase': artifact('json-showcase', showcase),
      'crew': artifact('crew', child),
    }
    const host = SFCHost.createRuntime({
      id: 'json-showcase-runtime',
      model: RComponentSFC.fromPlain({ id: 7, identity: 'json-showcase', name: 'JSON showcase', source: '' }),
      // Host ищет свой artifact по id модели (7), вложенный Component — по identity.
      artifactReader: { getArtifact: <TPayload>(_type: string, key: string | number) => (artifacts[key === 7 ? 'json-showcase' : String(key)] ?? null) as unknown as ProgramArtifact<TPayload> },
    })
    const rows = [
      { id: 1, status: 'Посадка', load: 0.5, at: '' },
      { id: 2, status: 'Вылетел', load: 1, at: '' },
      { id: 3, status: 'Задержан', load: 0, at: '' },
    ]
    const ui = mountEndgeUIJson(host, { input: { kind: 'local', props: { rows } }, locale: 'ru-RU', tableRowLimit: 2, schedule: 'sync' })
    const snapshot = ui.snapshot()
    expectValidSnapshot(snapshot)
    const nodes = flatten(snapshot.roots)
    const box = snapshot.roots[0]!
    expect(box).toMatchObject({ type: 'Box', classes: ['card'], style: { gap: '8px' }, props: { p: '2' } })
    expect(box.props).not.toHaveProperty('class')
    expect(nodes.find(node => node.type === 'Number')?.text).toBe(`1${' '}234,5 т`)
    expect(nodes.find(node => node.type === 'DateTime')?.text).toBe('15:40')
    expect(nodes.find(node => node.type === 'Component')).toMatchObject({ component: 'crew', children: [{ type: 'Badge', children: [{ type: '#text', text: 'КВС' }] }] })

    const table = nodes.find(node => node.type === 'Table')!
    expect(table.table).toEqual({ rowKey: 'id', columns: [{ key: 'status', title: 'Статус' }, { key: 'load', title: 'Загрузка', width: 120 }], rowCount: 3, offset: 0, limit: 2 })
    expect(table.props).not.toHaveProperty('rows')
    expect(table.markers?.map(marker => marker.code)).toEqual(['endge-ui-table-window'])
    expect(table.children.map(row => [row.type, row.props.key, row.children.map(cell => textOf(cell))])).toEqual([
      ['#row', 1, ['Посадка', '0,5']],
      ['#row', 2, ['Вылетел', '1']],
    ])

    // Editable в ячейке: вход, черновик и подтверждение уходят в host и публичный Event.
    const editable = table.children[0]!.children[0]!.children[0]!
    expect(editable).toMatchObject({ type: 'Text', editable: { active: false, value: 'Посадка', triggers: [{ event: 'dblclick' }] } })
    expect(editable.events).toEqual(expect.arrayContaining(['edit.begin', 'edit.commit']))
    const edited: unknown[] = []
    host.onEventPort('edited', occurrence => edited.push(occurrence.payload))
    await ui.dispatch(editable.id, 'edit.begin')
    expect(flatten(ui.snapshot().roots).find(node => node.id === editable.id)?.editable).toMatchObject({ active: true, draft: 'Посадка' })
    await ui.dispatch(editable.id, 'edit.input', { value: 'Отменён' })
    await ui.dispatch(editable.id, 'edit.commit', { value: 'Отменён' })
    expect(edited).toEqual([{ id: 1, patch: { status: 'Отменён' } }])
    expect(flatten(ui.snapshot().roots).find(node => node.id === editable.id)?.editable?.active).toBe(false)

    // Окно строк таблицы переключается событием table.page.
    const patches: EndgeUIPatch[] = []
    ui.subscribe(patch => patches.push(patch))
    await ui.dispatch(table.id, 'table.page', { offset: 2 })
    const paged = flatten(ui.snapshot().roots).find(node => node.id === table.id)!
    expect(paged.table).toMatchObject({ offset: 2, limit: 2, rowCount: 3 })
    expect(paged.children.map(row => row.props.key)).toEqual([3])
    expect(patches.at(-1)!.ops.some(op => op.op === 'children' && op.id === table.id)).toBe(true)

    ui.unmount()
    host.destroy()
  })

  it('цепочка if/else-if/else и маркеры вложенного Component, held-клавиш и отсутствующего IR', async () => {
    await bootTenant('afl')
    const compiled = (source: string) => {
      const result = compileComponentSFC(source)
      expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([])
      return result
    }
    const markersSource = compiled(`<script setup lang="ts">
defineProps<{ level: number, target: string }>()
</script>
<template>
  <Box>
    <Text if="level > 2">high</Text>
    <Text else-if="level > 1">mid</Text>
    <Text else>low</Text>
    <Text value="hold" :on="{ event: 'click', held: { code: ['KeyW'] }, reaction: action({ identity: 'audit.hold' }) }">hold</Text>
    <Component :is="target" />
    <Component is="ghost" />
    <Component is="loop" />
    <Component is="crew" />
  </Box>
</template>`)
    // Компилятор не принимает :on на Component; IR с interactions (другая версия компилятора)
    // моделируется переносом interactions с Text — адаптер должен пометить их маркером.
    interface MutableIrNode { tag?: string, children: MutableIrNode[], interactions?: unknown }
    const roots = markersSource.ir!.template.roots as unknown as MutableIrNode[]
    const box = roots.find(node => node.tag === 'Box')!
    const crewNode = box.children.filter(node => node.tag === 'Component').at(-1)!
    crewNode.interactions = box.children.find(node => node.interactions)!.interactions
    const artifacts: Record<string, ProgramArtifact<ComponentSFCProgramPayload>> = {
      'json-markers': artifact('json-markers', markersSource),
      'loop': artifact('loop', compiled(`<template><Flex><Component is="loop" /></Flex></template>`)),
      'crew': artifact('crew', compiled(`<template><Badge>crew</Badge></template>`)),
    }
    const createHost = (id: number, identity: string) => SFCHost.createRuntime({
      id: `${identity}-runtime`,
      model: RComponentSFC.fromPlain({ id, identity, name: identity, source: '' }),
      artifactReader: { getArtifact: <TPayload>(_type: string, key: string | number) => (artifacts[key === id ? identity : String(key)] ?? null) as unknown as ProgramArtifact<TPayload> },
    })

    const host = createHost(9, 'json-markers')
    const ui = mountEndgeUIJson(host, { input: { kind: 'local', props: { level: 2, target: '' } }, schedule: 'sync' })
    const snapshot = ui.snapshot()
    expectValidSnapshot(snapshot)
    const nodes = flatten(snapshot.roots)
    expect(nodes.filter(node => node.type === 'Text').map(textOf)).toEqual(['mid', 'hold'])
    expect(nodes.find(node => textOf(node) === 'hold' && node.type === 'Text')?.markers?.map(marker => marker.code)).toEqual(['endge-ui-held-keys'])
    const components = snapshot.roots[0]!.children.filter(node => node.type === 'Component')
    expect(components.map(node => node.markers?.map(marker => marker.code) ?? [])).toEqual([
      ['endge-ui-component-missing'],
      ['endge-ui-component-missing'],
      [],
      ['endge-ui-unsupported'],
    ])
    // Вложенный loop рисуется один раз, его повторное включение отмечено циклом.
    const loop = components[2]!
    expect(flatten(loop.children).find(node => node.type === 'Component')?.markers?.map(marker => marker.code)).toEqual(['endge-ui-component-cycle'])
    expect(textOf(components[3]!)).toBe('crew')
    ui.unmount()
    host.destroy()

    artifacts['no-ir'] = artifact('no-ir', { ...markersSource, ir: undefined } as unknown as ComponentSFCProgramPayload)
    const empty = createHost(5, 'no-ir')
    const emptyUi = mountEndgeUIJson(empty, { input: { kind: 'local', props: {} }, schedule: 'sync' })
    expect(emptyUi.snapshot()).toMatchObject({ roots: [], markers: [{ code: 'endge-ui-ir-missing', severity: 'error' }] })
    emptyUi.unmount()
    empty.destroy()
  })

  it('меню таблицы и :on-триггеры выполняют Action через dispatch', async () => {
    await bootTenant('afl')
    const execute = vi.spyOn(Endge.actions, 'execute').mockResolvedValue(undefined as never)
    const compiled = compileComponentSFC(`<script setup lang="ts">
defineProps<{ rows: Array<{ id: number, status: string }> }>()
</script>
<template>
  <Box>
    <Text value="enter" :on="{ event: 'click', button: 0, reaction: action({ identity: 'audit.click', input: { source: 'text' } }) }">enter</Text>
    <Table :rows="rows" row-key="id">
      <ColumnMenu>
        <MenuItem action="built-in-console-log" label="Колонка" :input="{ column: columnKey }" />
      </ColumnMenu>
      <RowMenu>
        <MenuItem action="built-in-console-log" label="Открыть" :input="{ rowId, value }" />
        <MenuSeparator />
        <MenuItem action="built-in-console-log" :label="row.id === 2 ? '' : 'Скрыть'" :input="{ hidden: rowId }" />
      </RowMenu>
      <Column key="status" title="Статус" />
    </Table>
  </Box>
</template>`)
    expect(compiled.diagnostics.filter(item => item.severity === 'error')).toEqual([])
    const artifacts: Record<string, ProgramArtifact<ComponentSFCProgramPayload>> = { 'json-menus': artifact('json-menus', compiled) }
    const host = SFCHost.createRuntime({
      id: 'json-menus-runtime',
      model: RComponentSFC.fromPlain({ id: 11, identity: 'json-menus', name: 'JSON menus', source: '' }),
      artifactReader: { getArtifact: <TPayload>(_type: string, key: string | number) => (artifacts[key === 11 ? 'json-menus' : String(key)] ?? null) as unknown as ProgramArtifact<TPayload> },
    })
    const rows = [{ id: 1, status: 'Посадка' }, { id: 2, status: 'Вылетел' }]
    const ui = mountEndgeUIJson(host, { input: { kind: 'local', props: { rows } }, schedule: 'sync' })
    const snapshot = ui.snapshot()
    expectValidSnapshot(snapshot)
    const nodes = flatten(snapshot.roots)
    const table = nodes.find(node => node.type === 'Table')!
    expect(table.events).toEqual(expect.arrayContaining(['menu.select', 'table.page']))
    expect(table.table?.columns[0]?.menu?.items.map(item => item.kind === 'item' ? item.label : item.kind)).toEqual(['Колонка'])

    // Меню строки: пустой label скрывает пункт, висячий разделитель убирается.
    const [first, second] = table.children.map(row => row.children[0]!)
    expect(first!.menu?.items.map(item => item.kind === 'item' ? item.label : item.kind)).toEqual(['Открыть', 'separator', 'Скрыть'])
    expect(second!.menu?.items.map(item => item.kind === 'item' ? item.label : item.kind)).toEqual(['Открыть'])
    expect(first!.events).toContain('menu.select')

    expect(await ui.dispatch(first!.id, 'menu.select', { item: 'built-in-console-log' })).toEqual({ handled: true })
    expect(execute).toHaveBeenLastCalledWith('built-in-console-log', {
      // rowId — строковая identity строки, как в Vue-адаптере.
      input: { rowId: '1', value: 'Посадка' },
      context: expect.objectContaining({ source: 'endge-ui-json', component: 'json-menus', rowKey: 1, column: 'status' }),
    })
    execute.mockClear()
    await ui.dispatch(first!.id, 'menu.select', { item: 'missing-item' })
    expect(execute).not.toHaveBeenCalled()

    await ui.dispatch(table.id, 'menu.select', { item: 'built-in-console-log', column: 'status' })
    expect(execute).toHaveBeenLastCalledWith('built-in-console-log', expect.objectContaining({
      context: expect.objectContaining({ source: 'endge-ui-json', column: 'status' }),
    }))

    // :on выбирает правило по payload: другая кнопка мыши не совпадает с триггером.
    const text = nodes.find(node => node.type === 'Text' && textOf(node) === 'enter')!
    expect(text.events).toContain('click')
    execute.mockClear()
    expect(await ui.dispatch(text.id, 'click', { button: 2 })).toEqual({ handled: true })
    expect(execute).not.toHaveBeenCalled()
    await ui.dispatch(text.id, 'click', { button: 0 })
    expect(execute.mock.calls.map(call => call[0])).toEqual(['audit.click'])

    ui.unmount()
    host.destroy()
  })

  it('пример DOM-хоста строит разметку, применяет патчи и отправляет клики', async () => {
    await bootTenant('kzn')
    const { session, inspector } = await mountInspector()
    const ui = mountEndgeUIJson(inspector)
    const host = createEndgeUIDomHost(createFakeDocument(), ui)
    expect(html(host.root)).toContain('<span data-endge-type="Text">Инспектор КЗН SU 1402</span><span data-endge-type="Badge">kzn</span>')
    expect(html(host.root)).toContain('<span data-endge-type="Text">Стоянка</span><span data-endge-type="Badge">S12</span>')

    const received: unknown[] = []
    inspector.onEventPort('sectionSelected', occurrence => received.push(occurrence.payload))
    const title = find(host.root, element => element.listeners.has('click'))!
    title.listeners.get('click')!({ target: {} })
    await vi.waitFor(() => expect(received).toEqual([{ title: 'Рейс' }]))

    const input = inspector.getInputSource()
    const path = input?.kind === 'raph' ? input.bindings.model!.path : ''
    Raph.set(path, { ...(Raph.get(path) as object), title: 'Инспектор КЗН SU 1500' })
    await vi.waitFor(() => expect(html(host.root)).toContain('>Инспектор КЗН SU 1500<'))

    host.destroy()
    ui.unmount()
    await session.unmount()
  })
})

// Минимальный DOM для примера host-а в node-окружении тестов.
interface FakeNode { tag: string, text: string | null, attrs: Map<string, string>, children: FakeNode[], parent: FakeNode | null, listeners: Map<string, (event: unknown) => void> }

function fakeNode(tag: string, text: string | null = null): FakeNode & Record<string, unknown> {
  const node: FakeNode & Record<string, unknown> = {
    tag,
    text,
    attrs: new Map(),
    children: [],
    parent: null,
    listeners: new Map(),
    style: { setProperty: () => {} },
    setAttribute: (name: string, value: string) => node.attrs.set(name, value),
    addEventListener: (type: string, listener: (event: unknown) => void) => node.listeners.set(type, listener),
    replaceChildren: (...children: FakeNode[]) => {
      node.children = children
      for (const child of children) {
        child.parent = node
      }
    },
    replaceWith: (next: FakeNode) => {
      const parent = node.parent
      if (parent) {
        parent.children = parent.children.map(child => child === node ? next : child)
        next.parent = parent
      }
    },
  }
  Object.defineProperty(node, 'textContent', {
    get: () => node.text,
    set: (value: string) => {
      node.text = value
    },
  })
  return node
}

function createFakeDocument(): Parameters<typeof createEndgeUIDomHost>[0] {
  return {
    createElement: (tag: string) => fakeNode(tag),
    createTextNode: (text: string) => fakeNode('#text', text),
  } as unknown as Parameters<typeof createEndgeUIDomHost>[0]
}

function html(node: unknown): string {
  const item = node as FakeNode
  if (item.tag === '#text') {
    return item.text ?? ''
  }
  const type = item.attrs.get('data-endge-type')
  const inner = item.children.length ? item.children.map(html).join('') : (item.text ?? '')
  return `<${item.tag}${type ? ` data-endge-type="${type}"` : ''}>${inner}</${item.tag}>`
}

function find(node: unknown, predicate: (node: FakeNode) => boolean): FakeNode | null {
  const item = node as FakeNode
  if (predicate(item)) {
    return item
  }
  for (const child of item.children) {
    const found = find(child, predicate)
    if (found) {
      return found
    }
  }
  return null
}

function artifact(identity: string, payload: ComponentSFCProgramPayload): ProgramArtifact<ComponentSFCProgramPayload> {
  return {
    ref: { entityType: 'component-sfc', id: identity.length, identity },
    sourceHash: identity,
    compilerVersion: 'test',
    status: 'valid',
    diagnostics: [],
    dependencies: [],
    capabilities: ['compilable', 'executable', 'renderable'],
    metadata: { self: {}, nodes: [] },
    payload,
  }
}
