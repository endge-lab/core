import type { EndgeDomainBundle } from '@/features/core/modules/domain/types/document/domain-export.type'

import { TEST_ENDGE_WORKSPACE } from '@/test/fixtures/endge-workspace'

// Сквозной пример АФЛ/КЗН: инспектор рейса с разной мета-конфигурацией по тенантам.
// Тот же bundle опубликован для cookbook и ручной проверки UI:
// web/apps/egorkozelskij-endge-web-configurator-docs/docs/public/examples/tenant-inspector.json
// (формат GET /api/v1/domain/export, импорт через /api/v1/domain/import/plan + /api/v1/domain/import).

export const TENANT_INSPECTOR_WORKSPACE_SCHEMA_VERSION = 10

export const TENANT_INSPECTOR_GRAPHQL_ENDPOINT = 'https://flights.example.test/graphql'

const TYPE_FLIGHT = `defineType({
  id: field(String),
  number: field(String),
  status: field(String),
  departure: field(String),
  gate: field(String).optional(),
  crew: field(arrayOf(type('CrewMember'))),
})`

const TYPE_FLIGHT_KZN = `defineType({
  extends: type('Flight'),
  fields: {
    stand: field(String),
    handlingAgent: field(String),
  },
})`

const TYPE_CREW_MEMBER = `defineType({
  role: field(String),
  name: field(String),
})`

const TYPE_INSPECTOR_FIELD = `defineType({
  label: field(String),
  path: field(String),
  format: field(String),
})`

const TYPE_INSPECTOR_SECTION = `defineType({
  title: field(String),
  fields: field(arrayOf(type('InspectorField'))),
})`

// Схема инспектора: секции -> поля (подпись, путь W1 в объекте рейса, формат).
const AFL_SECTIONS = [
  {
    title: 'Рейс',
    fields: [
      { label: 'Номер', path: 'number', format: 'text' },
      { label: 'Статус', path: 'status', format: 'badge' },
      { label: 'Вылет', path: 'departure', format: 'text' },
    ],
  },
  {
    title: 'Перрон',
    fields: [
      { label: 'Выход', path: 'gate', format: 'text' },
      { label: 'КВС', path: 'crew[role="PIC"].name', format: 'text' },
    ],
  },
]

const KZN_SECTIONS = [
  {
    title: 'Рейс',
    fields: [
      { label: 'Номер', path: 'number', format: 'text' },
      { label: 'Статус', path: 'status', format: 'badge' },
    ],
  },
  {
    title: 'Наземное обслуживание',
    fields: [
      { label: 'Стоянка', path: 'stand', format: 'badge' },
      { label: 'Агент', path: 'handlingAgent', format: 'text' },
      { label: 'Второй пилот', path: 'crew[role="FO"].name', format: 'text' },
    ],
  },
]

const CONFIGURATION_INSPECTOR = `defineConfig({
  title: value(String, 'Инспектор рейса').label('Заголовок'),
  sections: value(arrayOf(type('InspectorSection')), ${JSON.stringify(AFL_SECTIONS)}).label('Секции инспектора'),
})`

// Один Query по супермножеству схемы: тенант выбирает фрагмент и contract output.
const QUERY_FLIGHT = `defineQuery({
  kind: 'graphql',
  props: defineProps({ id: field(String) }),
  request: {
    endpoint: '${TENANT_INSPECTOR_GRAPHQL_ENDPOINT}',
    document: gql\`query Flight($id: ID!) { flight(id: $id) { ...FlightFields } }\`,
    fragments: {
      FlightFields: contextSwitch({
        default: gql\`fragment FlightFields on Flight { id number status departure gate crew { role name } }\`,
        cases: [{
          when: { tenant: 'kzn' },
          use: gql\`fragment FlightFields on Flight { id number status departure stand handlingAgent crew { role name } }\`,
        }],
      }),
    },
    variables: variables(({ prop }) => ({ id: prop('id') })),
    headers: { 'X-Tenant': facet('tenant') },
  },
  outputs: {
    flight: output().from(response('flight')).contract(field(contextSwitch({
      default: type('Flight'),
      cases: [{ when: { tenant: 'kzn' }, use: type('FlightKzn') }],
    }))),
    inspector: output().from(response('flight')).dataView('inspector-model'),
  },
})`

// Рейс + схема из Configuration текущего тенанта -> модель инспектора.
const DATA_VIEW_INSPECTOR_MODEL = `defineDataView({
  mode: 'projection',
  output: {
    tenant: facet('tenant'),
    title: concat(config('inspector.title'), ' ', path('number')),
    sections: config('inspector.sections').map({
      title: get('title'),
      fields: get('fields').map({
        label: get('label'),
        format: get('format'),
        value: get(path(''), get('path')),
      }),
    }),
  },
})`

const COMPOSITION_FLIGHT_INSPECTOR = `defineComposition({
  runtimes: {
    flight: query('flight').withProps({ id: 'SU1402' }),
    inspector: component('flight-inspector').withProps({ model: fromOutput('flight', 'inspector') }),
    handling: component('kzn-handling')
      .enabledWhen(context({ tenant: 'kzn' }))
      .withProps({ flight: fromOutput('flight', 'flight') }),
  },
  hooks: [onMount().run('flight')],
})`

const COMPONENT_FLIGHT_INSPECTOR = `<script setup lang="ts">
defineProps<{
  model: {
    tenant: string
    title: string
    sections: Array<{
      title: string
      fields: Array<{ label: string, format: string, value: string }>
    }>
  }
}>()
</script>

<template>
  <Flex col gap="3">
    <Flex row gap="2" align="center">
      <Text weight="600">{{ model.title }}</Text>
      <Badge tone="info">{{ model.tenant }}</Badge>
    </Flex>
    <Flex col gap="2" for="section in model.sections" :key="section.title">
      <Text weight="600">{{ section.title }}</Text>
      <Flex row gap="2" align="center" for="item in section.fields" :key="item.label">
        <Text>{{ item.label }}</Text>
        <Badge if="item.format === 'badge'" tone="warning">{{ item.value }}</Badge>
        <Text else>{{ item.value }}</Text>
      </Flex>
    </Flex>
  </Flex>
</template>
`

const COMPONENT_KZN_HANDLING = `<script setup lang="ts">
defineProps<{
  flight: { stand: string, handlingAgent: string }
}>()
</script>

<template>
  <Flex row gap="2" align="center">
    <Text>Стоянка</Text>
    <Badge tone="info">{{ flight.stand }}</Badge>
    <Text>{{ flight.handlingAgent }}</Text>
  </Flex>
</template>
`

const EMPTY_DOCUMENTS: EndgeDomainBundle['documents'] = {
  'facets': [],
  'facet-documents': [],
  'folders': [],
  'types': [],
  'queries': [],
  'data-views': [],
  'compositions': [],
  'stores': [],
  'streams': [],
  'simulations': [],
  'updates': [],
  'mocks': [],
  'components': [],
  'actions': [],
  'filters': [],
  'converters': [],
  'computations': [],
  'vocabs': [],
  'i18n-bundles': [],
  'auth-profiles': [],
  'navigations': [],
  'styles': [],
  'configurations': [],
}

function sectionsPatch(sections: unknown) {
  return { mode: 'inherit', patch: { values: { inspector: { sections: { op: 'set', value: sections } } } } }
}

function sourceDocument(identity: string, displayName: string, source: string, sourceVersion = 1, extra: Record<string, unknown> = {}) {
  return { identity, displayName, description: null, managedBy: 'user', meta: {}, source, sourceVersion, ...extra }
}

// Создаёт переносимый workspace snapshot примера (новый объект на каждый вызов).
export function createTenantInspectorBundle(): EndgeDomainBundle {
  const { installedIntegrations: _installed, dataMode: _dataMode, ...workspace } = TEST_ENDGE_WORKSPACE
  return {
    schemaVersion: TENANT_INSPECTOR_WORKSPACE_SCHEMA_VERSION,
    kind: 'workspace-snapshot',
    workspace: {
      ...structuredClone(workspace),
      identity: 'tenant-inspector',
      displayName: 'Инспектор рейса АФЛ/КЗН',
      startupCompositionIdentity: 'flight-inspector',
      dataMode: 'development',
    },
    installedIntegrations: [],
    documents: {
      ...structuredClone(EMPTY_DOCUMENTS),
      'facets': [
        { identity: 'tenant', displayName: 'Тенант', description: 'Авиакомпания или аэропорт, для которого собирается приложение.', icon: 'Building2', color: '#2563eb', position: 0, managedBy: 'user', meta: {} },
      ],
      'facet-documents': [
        { identity: 'afl', facetIdentity: 'tenant', displayName: 'АФЛ', description: null, managedBy: 'user', meta: {}, configuration: sectionsPatch(AFL_SECTIONS) },
        { identity: 'kzn', facetIdentity: 'tenant', displayName: 'КЗН', description: null, managedBy: 'user', meta: {}, configuration: { mode: 'inherit', patch: { values: { inspector: { title: { op: 'set', value: 'Инспектор КЗН' }, sections: { op: 'set', value: KZN_SECTIONS } } } } } },
      ],
      'types': [
        sourceDocument('CrewMember', 'Член экипажа', TYPE_CREW_MEMBER),
        sourceDocument('Flight', 'Рейс', TYPE_FLIGHT),
        sourceDocument('FlightKzn', 'Рейс КЗН', TYPE_FLIGHT_KZN),
        sourceDocument('InspectorField', 'Поле инспектора', TYPE_INSPECTOR_FIELD),
        sourceDocument('InspectorSection', 'Секция инспектора', TYPE_INSPECTOR_SECTION),
      ],
      'configurations': [
        sourceDocument('inspector', 'Инспектор', CONFIGURATION_INSPECTOR),
      ],
      'queries': [
        sourceDocument('flight', 'Рейс (GraphQL)', QUERY_FLIGHT, 2),
      ],
      'data-views': [
        sourceDocument('inspector-model', 'Модель инспектора', DATA_VIEW_INSPECTOR_MODEL),
      ],
      'components': [
        { identity: 'flight-inspector', displayName: 'Инспектор рейса', description: null, managedBy: 'user', meta: {}, source: COMPONENT_FLIGHT_INSPECTOR, modelVersion: 1 },
        { identity: 'kzn-handling', displayName: 'Обслуживание КЗН', description: null, managedBy: 'user', meta: {}, source: COMPONENT_KZN_HANDLING, modelVersion: 1 },
      ],
      'compositions': [
        sourceDocument('flight-inspector', 'Инспектор рейса', COMPOSITION_FLIGHT_INSPECTOR, 1, { kind: 'workspace' }),
      ],
    },
  }
}

// Ответ поддельного GraphQL-сервера: супермножество полей обоих тенантов.
export const TENANT_INSPECTOR_FLIGHT = Object.freeze({
  id: 'SU1402',
  number: 'SU 1402',
  status: 'Посадка',
  departure: '2026-10-26T18:40:00+03:00',
  gate: 'B7',
  stand: 'S12',
  handlingAgent: 'Казань Хендлинг',
  crew: [
    { role: 'PIC', name: 'Иванов' },
    { role: 'FO', name: 'Петров' },
  ],
})
