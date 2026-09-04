// @vitest-environment node
import type { EndgeBootContext } from '@/kernel/types/bootstrap.types'

import { describe, expect, it } from 'vitest'

import { EndgeFederation } from '@/kernel/EndgeFederation'
import { EndgeModule } from '@/kernel/EndgeModule'

interface Deferred {
  promise: Promise<void>
  resolve: () => void
}

function createDeferred(): Deferred {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function createBootContext(): EndgeBootContext {
  return {
    dataProvider: 'plain',
    scope: {},
    vars: {},
    plainSource: {},
  }
}

function uniqueFederationId(label: string): string {
  return `${label}-${Date.now()}-${Math.random()}`
}

describe('машина состояний жизненного цикла EndgeFederation', () => {
  /** Проверяет single-flight boot и запрет подмены активного контекста. */
  it('разделяет один запуск для одинакового контекста и отклоняет другой контекст', async () => {
    const setupGate = createDeferred()

    class TestModule extends EndgeModule {
      public override async setup(): Promise<void> {
        await setupGate.promise
      }
    }

    class TestFederation extends EndgeFederation {
      protected static override readonly federationId = uniqueFederationId('concurrent-boot')

      protected static override configureFederation(): void {
        this.defineModule({ key: 'module', module: new TestModule() })
      }
    }

    const context = createBootContext()
    const firstBoot = TestFederation.boot(context)
    const secondBoot = TestFederation.boot(context)

    expect(secondBoot).toBe(firstBoot)
    await expect(TestFederation.boot(createBootContext())).rejects.toThrow('another context')
    await expect(TestFederation.reset()).rejects.toThrow('while boot is running')
    await expect(TestFederation.build()).rejects.toThrow('state "booting"')

    setupGate.resolve()
    await firstBoot
    expect(TestFederation.state).toBe('ready')
  })

  /** Проверяет rollback каждой boot phase и разрешённый retry после успешной очистки. */
  it.each(['setup', 'load', 'build', 'start'] as const)(
    'откатывает затронутые модули после ошибки %s и разрешает повтор',
    async (failedPhase) => {
      const calls: string[] = []
      let shouldFail = true

      class TestModule extends EndgeModule {
        public constructor(private readonly _key: string) {
          super()
        }

        public override setup(): void {
          this._record('setup')
        }

        public override load(): void {
          this._record('load')
        }

        public override build(): void {
          this._record('build')
        }

        public override start(): void {
          this._record('start')
        }

        public override reset(): void {
          calls.push(`${this._key}:reset`)
        }

        private _record(phase: typeof failedPhase): void {
          calls.push(`${this._key}:${phase}`)
          if (this._key === 'second' && phase === failedPhase && shouldFail) {
            shouldFail = false
            throw new Error(`${phase} failed`)
          }
        }
      }

      class TestFederation extends EndgeFederation {
        protected static override readonly federationId = uniqueFederationId(`rollback-${failedPhase}`)

        protected static override configureFederation(): void {
          this.defineModule({ key: 'first', module: new TestModule('first') })
          this.defineModule({ key: 'second', module: new TestModule('second') })
        }
      }

      const context = createBootContext()
      await expect(TestFederation.boot(context)).rejects.toThrow(`${failedPhase} failed`)
      expect(calls.slice(-2)).toEqual(['second:reset', 'first:reset'])
      expect(TestFederation.state).toBe('idle')

      await TestFederation.boot(context)
      expect(TestFederation.state).toBe('ready')
    },
  )

  /** Проверяет failed-state при ошибке rollback и восстановление отдельным reset. */
  it('сохраняет исходную ошибку и ошибку отката до успешного восстановительного reset', async () => {
    let resetShouldFail = true

    class TestModule extends EndgeModule {
      public override start(): void {
        throw new Error('start failed')
      }

      public override reset(): void {
        if (resetShouldFail) {
          resetShouldFail = false
          throw new Error('rollback failed')
        }
      }
    }

    class TestFederation extends EndgeFederation {
      protected static override readonly federationId = uniqueFederationId('rollback-failure')

      protected static override configureFederation(): void {
        this.defineModule({ key: 'module', module: new TestModule() })
      }
    }

    const context = createBootContext()
    await expect(TestFederation.boot(context)).rejects.toMatchObject({
      errors: expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining('start failed') }),
        expect.objectContaining({ message: expect.stringContaining('rollback failed') }),
      ]),
    })
    expect(TestFederation.state).toBe('failed')
    await expect(TestFederation.boot(context)).rejects.toThrow('reset is required')

    await TestFederation.reset()
    expect(TestFederation.state).toBe('idle')
  })

  /** Проверяет FIFO rebuild, изоляцию ошибки и продолжение очереди. */
  it('выполняет пересборки в порядке FIFO и продолжает после одной ошибки', async () => {
    const firstBuildGate = createDeferred()
    const starts: number[] = []
    let buildNumber = 0

    class TestModule extends EndgeModule {
      public override async build(): Promise<void> {
        buildNumber += 1
        const current = buildNumber
        if (current === 1) {
          return
        }

        starts.push(current)
        if (current === 2) {
          await firstBuildGate.promise
        }
        if (current === 3) {
          throw new Error('queued build failed')
        }
      }
    }

    class TestFederation extends EndgeFederation {
      protected static override readonly federationId = uniqueFederationId('fifo-build')

      protected static override configureFederation(): void {
        this.defineModule({ key: 'module', module: new TestModule() })
      }
    }

    await TestFederation.boot(createBootContext())
    const first = TestFederation.build()
    const second = TestFederation.build()
    const third = TestFederation.build()
    void second.catch(() => undefined)

    await Promise.resolve()
    expect(starts).toEqual([2])

    firstBuildGate.resolve()
    await first
    await expect(second).rejects.toThrow('queued build failed')
    await third

    expect(starts).toEqual([2, 3, 4])
    expect(TestFederation.state).toBe('ready')
    expect(TestFederation.isInitialized).toBe(true)
  })

  /** Проверяет ожидание build queue и single-flight reset. */
  it('ожидает поставленные в очередь сборки и разделяет один конкурентный reset', async () => {
    const buildGate = createDeferred()
    const calls: string[] = []
    let buildNumber = 0

    class TestModule extends EndgeModule {
      public override async build(): Promise<void> {
        buildNumber += 1
        if (buildNumber > 1) {
          calls.push('build:start')
          await buildGate.promise
          calls.push('build:end')
        }
      }

      public override reset(): void {
        calls.push('reset')
      }
    }

    class TestFederation extends EndgeFederation {
      protected static override readonly federationId = uniqueFederationId('concurrent-reset')

      protected static override configureFederation(): void {
        this.defineModule({ key: 'module', module: new TestModule() })
      }
    }

    await TestFederation.boot(createBootContext())
    const build = TestFederation.build()
    const firstReset = TestFederation.reset()
    const secondReset = TestFederation.reset()

    expect(secondReset).toBe(firstReset)
    await Promise.resolve()
    expect(calls).toEqual(['build:start'])

    buildGate.resolve()
    await build
    await firstReset

    expect(calls).toEqual(['build:start', 'build:end', 'reset'])
    expect(TestFederation.state).toBe('idle')
  })
})
