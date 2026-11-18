import { bench, describe } from 'vitest'
import { PageCacheService } from '@/features/core/modules/runtime/services/controllers/cache/PageCacheService'

for (const entries of [50, 500]) {
  describe(`memory page cache: ${entries} resident pages, 100 x 1KiB`, () => {
    const service = new PageCacheService()
    let cache: ReturnType<PageCacheService['create']>
    const create = () => service.create({ key: 'bench', storage: 'memory', maxEntries: 500, maxBytes: 64 * 1024 * 1024 }, () => ({ user: 'fixture', workspace: 'bench' }))
    let cleanup = Promise.resolve()
    const setup = async () => {
      await cleanup
      cache = create()
      await cache.select({ status: 'active' })
      for (let offset = 0; offset < entries; offset++) {
        await cache.write({ offset }, { rows: Array.from({ length: 100 }, (_, id) => ({ id, payload: 'x'.repeat(1024) })), offset, total: 500000 })
      }
    }
    const teardown = () => {
      cleanup = service.reset()
    }
    bench('warm hit: key + LRU + independent page', async () => {
      await cache.read({
        offset: entries - 1,
      })
    }, {
      time: 2000,
      warmupTime: 500,
      iterations: 20,
      setup,
      teardown,
    })
    bench('miss: no scan of retained pages', async () => {
      await cache.read({
        offset: -1,
      })
    }, {
      time: 2000,
      warmupTime: 500,
      iterations: 20,
      setup,
      teardown,
    })
  })
}
