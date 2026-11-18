import type { ControllerDefinition } from '../../../domain/controllers/controller.types'
import type { SourceFieldDefinition } from '@/features/core/modules/source/domain/types/source-expression.types'

function field(key: string, type: string, defaultValue?: unknown): SourceFieldDefinition {
  return {
    key,
    type,
    optional: true,
    array: false,
    ...(defaultValue === undefined
      ? {}
      : {
          defaultValue: {
            type: 'literal' as const,
            value: defaultValue,
          },
        }),
  }
}
export
const collectionWindowDefinition: ControllerDefinition = {
  identity: 'endge.collection-window',
  displayName: 'Collection window',
  origin: {
    kind: 'builtin',
    owner: '@endge/core',
  },
  catalogPath: ['Data', 'Collections'],
  defaultProviderKey: 'endge.collection-window.default',
  contract: {
    props: [field('paging', 'String', 'cursor'), field('rowKey', 'String', 'id'), field('batchSize', 'Number', 100), field('prefetchRows', 'Number', 20), field('maxLoadedRows', 'Number', 1000), field('request', 'Object', {}), field('initialOffset', 'Number', 0), field('autoLoad', 'Boolean', true), field('retention', 'Object')],
    outputs: [field('rows', 'Object'), field('rowsRevision', 'Number'), field('loading', 'Boolean'), field('error', 'Object'), field('hasBefore', 'Boolean'), field('hasAfter', 'Boolean'), field('loadedRowCount', 'Number'), field('overLimit', 'Boolean'), field('refreshPending', 'Boolean'), field('cacheStatus', 'Object')].map(item => item.key === 'rows'
      ? {
          ...item,
          array: true,
        }
      : item),
    commands: Object.fromEntries(['loadInitial', 'setViewport', 'loadBefore', 'loadAfter', 'reset', 'refresh', 'clearCache', 'retry', 'retainRows', 'releaseRows'].map(name => [name, {}])),
    dependencies: {
      state: {
        kind: 'store',
      },
      load: {
        kind: 'query',
      },
    },
  },
}
