import { Raph } from '@raphy-js/raph'
import { bench, describe } from 'vitest'
import { Endge } from '@/features/core/kernel/endge'
import { RQuery } from '@/features/core/modules/domain/entities/RQuery'
import { createUpdateStoreRuntime } from '@/test/fixtures/update-source'
import { prepareTestCompilerContext, resetTestCompilerContext } from '@/test/helpers/compiler-context'

// Common baseline/candidate profile: real Store, guarded Update, SDK host and controller.
// No transport or fixture construction is included in the viewport sample.
let cleanup = Promise.resolve()
for (const [count, payloadBytes] of [[1000, 1024], [10000, 1024], [1000, 4096]]) {
  describe(`collection viewport: ${count} rows x ${payloadBytes} bytes`, () => {
    let host: Awaited<ReturnType<typeof Endge.runtime.controllers.mount>>
    let position = 100
    const setup = async () => {
      await cleanup
      if (!Raph.configured) {
        Raph.configure({
          mode: 'runtime',
        })
      }
      prepareTestCompilerContext()
      const store = createUpdateStoreRuntime({
        storeSource: 'defineStore({data:{window:value({revision:0,rowsRevision:0,blocks:[]})}})',
        updates: [{ identity: 'commit-window', source: 'defineUpdate({mutations:[{strategy:\'set\',target:\'window\',value:input(\'next\'),when:eq(data(\'window.revision\'),input(\'expectedRevision\'))}]})' }],
      })
      const query = Object.assign(new RQuery(), { id: 990, identity: 'bench-page', sourceVersion: 2, source: 'defineQuery({kind:\'rest\',request:{endpoint:\'https://api.example.test\',path:\'/rows\',method:\'GET\'},outputs:{page:output().from(response())}})' })
      Endge.domain.addQuery(query)
      Endge.compiler.buildQuery(query)
      const rows = Array.from({ length: count }, (_, id) => ({ id: String(id), payload: 'x'.repeat(payloadBytes) }))
      store.applyUpdate('commit-window', { expectedRevision: 0, next: { revision: 1, rowsRevision: 1, blocks: [{ rows, offset: 0, total: count, sourceCount: count, hasBefore: false, hasAfter: false }] } })
      host = await Endge.runtime.controllers.mount('endge.collection-window', { owner: store, props: { paging: 'offset', autoLoad: false, prefetchRows: 0, maxLoadedRows: count }, dependencies: { state: { store, path: 'window', update: 'commit-window' }, load: { query: 'bench-page', output: 'page' } } })
    }
    const teardown = () => {
      cleanup = Endge.runtime.reset().then(() => {
        resetTestCompilerContext()
        Raph.reset()
      })
    }
    bench('source-owned data -> viewport command -> retention/demand', async () => {
      position = 100 + (position + 7) % (count - 200)
      await host.command('setViewport', { rowsRevision: 1, firstVisible: { key: String(position), index: position }, lastVisible: { key: String(position + 20), index: position + 20 }, rowCount: count, reason: 'scroll' })
    }, { time: 500, warmupTime: 200, iterations: 20, setup, teardown })
  })
}
