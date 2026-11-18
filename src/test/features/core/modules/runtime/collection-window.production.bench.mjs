import { createDefaultEndgeConfiguration, Endge } from '@endge/core'
import { Raph } from '@raphy-js/raph'
import { bench, describe } from 'vitest'

// This entry is bundled twice against immutable production Core builds.
// Vitest remains external; baseline and candidate use exactly the same workload.
function workspace() {
  const documents = Object.fromEntries(['facets', 'facet-documents', 'folders', 'types', 'queries', 'data-views', 'compositions', 'stores', 'streams', 'simulations', 'updates', 'mocks', 'components', 'actions', 'filters', 'converters', 'computations', 'vocabs', 'i18n-bundles', 'auth-profiles', 'navigations', 'styles', 'configurations'].map(key => [key, []]))
  documents.stores = [{ identity: 'bench-state', sourceVersion: 1, source: 'defineStore({data:{window:value({revision:0,rowsRevision:0,blocks:[]})}})' }]
  documents.updates = [{ identity: 'bench-commit', storeIdentity: 'bench-state', sourceVersion: 1, source: 'defineUpdate({mutations:[{strategy:\'set\',target:\'window\',value:input(\'next\'),when:eq(data(\'window.revision\'),input(\'expectedRevision\'))}]})' }]
  documents.queries = [{ identity: 'bench-page', type: 'query-rest', sourceVersion: 2, source: 'defineQuery({kind:\'rest\',request:{endpoint:\'https://api.example.test\',path:\'/rows\',method:\'GET\'},outputs:{page:output().from(response())}})' }]
  documents.compositions = [{ identity: 'bench-window', sourceVersion: 1, source: 'defineComposition({data:{state:store(\'bench-state\').isolated()},runtimes:{window:controller(\'endge.collection-window\').withProps({paging:\'offset\',autoLoad:false,prefetchRows:0,maxLoadedRows:10000}).withDependencies({state:{store:data(\'state\'),path:\'window\',update:\'bench-commit\'},load:{query:\'bench-page\',output:\'page\'}})}})' }]
  return { kind: 'workspace-snapshot', schemaVersion: 5, workspace: { identity: 'window-benchmark', displayName: 'Window benchmark', startupCompositionIdentity: null, dataMode: 'production', managedBy: 'user', managedById: null, meta: {}, configuration: createDefaultEndgeConfiguration() }, installedIntegrations: [], documents }
}
let cleanup = Promise.resolve()
for (const [rows, bytes] of [[1000, 1024], [10000, 1024], [1000, 4096]]) {
  describe(`production viewport ${rows}x${bytes}`, () => {
    let host
    let position = 100
    const setup = async () => {
      await cleanup
      if (!Raph.configured) {
        Raph.configure({
          mode: 'runtime',
        })
      }
      Endge.context.configurePersistence({ context: 'disabled' })
      await Endge.boot({ dataProvider: 'bundle', bundleSource: workspace(), scope: { workspaceIdentity: 'window-benchmark' }, vars: {}, ui: { adapterFallbackIds: [] } })
      const invalid = Endge.program.getArtifacts().filter(item => item.status === 'error')
      if (invalid.length) {
        throw new Error(JSON.stringify(invalid.flatMap(item => item.diagnostics)))
      }
      const session = await Endge.runtime.composition.mount('bench-window')
      host = session.host.getChild('window')
      const store = Endge.runtime.getRuntimeHosts().find(item => item.entityType === 'store')
      const data = Array.from({ length: rows }, (_, id) => ({ id: String(id), payload: 'x'.repeat(bytes) }))
      store.applyUpdate('bench-commit', { expectedRevision: 0, next: { revision: 1, rowsRevision: 1, blocks: [{ rows: data, sourceCount: rows, offset: 0, total: rows, hasBefore: false, hasAfter: false }] } })
      await host.setProps({ maxLoadedRows: rows })
    }
    const teardown = () => {
      cleanup = Endge.reset()
    }
    bench('store -> viewport -> trim/demand', async () => {
      position = 100 + (position + 7) % (rows - 200)
      await host.command('setViewport', { rowsRevision: 1, firstVisible: { key: String(position), index: position }, lastVisible: { key: String(position + 20), index: position + 20 }, rowCount: rows, reason: 'scroll' })
    }, { time: 30000, warmupTime: 3000, iterations: 50, setup, teardown })
  })
}
