// @vitest-environment node
import type { EndgeFederationContext } from '@/features/federation/types/federation.types'

import { describe, expect, it } from 'vitest'

import { EndgeFederation } from '@/features/federation/EndgeFederation'
import { EndgeModule } from '@/features/federation/EndgeModule'

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

function createBootContext(): EndgeFederationContext {
  return {}
}

function uniqueFederationId(label: string): string {
  return `${label}-${Date.now()}-${Math.random()}`
}

describe('машина состояний жизненного цикла EndgeFederation', () => {
  /** Проверяет общий phase-order родителя и дочерней Federation. */
  it('проводит дочернюю федерацию через единый lifecycle graph', async () => {
    const calls: string[] = []

    class TestModule extends EndgeModule {
      public constructor(private readonly _key: string) {
        super()
      }

      public override setup(): void {
        calls.push(`${this._key}:setup`)
      }

      public override load(): void {
        calls.push(`${this._key}:load`)
      }

      public override build(): void {
        calls.push(`${this._key}:build`)
      }

      public override start(): void {
        calls.push(`${this._key}:start`)
      }

      public override reset(): void {
        calls.push(`${this._key}:reset`)
      }
    }

    const Child = EndgeFederation.define({
      id: uniqueFederationId('child-tree'),
      modules: [
        { key: 'inside', create: () => new TestModule('child') },
      ],
    })
    const Parent = EndgeFederation.define({
      id: uniqueFederationId('parent-tree'),
      modules: [
        { key: 'first', create: () => new TestModule('first') },
        { key: 'last', create: () => new TestModule('last') },
      ],
      federations: [
        {
          key: 'child',
          federation: Child,
          after: 'first',
          before: 'last',
        },
      ],
    })

    const context = createBootContext()
    await Parent.boot(context)

    expect(Parent.child).toBe(Child)
    expect(calls).toEqual([
      'first:setup',
      'child:setup',
      'last:setup',
      'first:load',
      'child:load',
      'last:load',
      'first:build',
      'child:build',
      'last:build',
      'first:start',
      'child:start',
      'last:start',
    ])
    expect(Child.state).toBe('ready')
    await expect(Child.boot(context)).rejects.toThrow('managed by parent federation')

    await Parent.reset()
    expect(calls.slice(-3)).toEqual(['last:reset', 'child:reset', 'first:reset'])
    expect(Child.state).toBe('idle')
  })

  /** Проверяет plugin-вклад Modules и Federations до общей сортировки graph. */
  it('добавляет plugin-узлы лениво и сортирует их вместе с federation graph', async () => {
    const calls: string[] = []

    class TestModule extends EndgeModule {
      public constructor(private readonly _key: string) {
        super()
      }

      public override start(): void {
        calls.push(this._key)
      }
    }

    const Child = EndgeFederation.define({
      id: uniqueFederationId('plugin-child'),
      modules: [
        { key: 'inside', create: () => new TestModule('child') },
      ],
    })
    const Parent = EndgeFederation.define({
      id: uniqueFederationId('plugin-parent'),
      modules: [
        { key: 'runtime', create: () => new TestModule('runtime') },
      ],
    })

    Parent.use({
      id: 'test-extension',
      modules: [
        { key: 'pluginModule', create: () => new TestModule('plugin'), before: 'pluginChild' },
      ],
      federations: [
        { key: 'pluginChild', federation: Child, before: 'runtime' },
      ],
    })

    expect(Parent.isConfigured).toBe(false)
    await Parent.boot(createBootContext())

    expect(Parent.getModule('pluginModule')).toBeTruthy()
    expect(Parent.getFederation('pluginChild')).toBe(Child)
    expect(calls).toEqual(['plugin', 'child', 'runtime'])
  })

  /** Проверяет accessor и instance при двух facade-копиях с одним runtime id. */
  it('синхронизирует plugin accessors между facade-копиями одного federation host', async () => {
    class TestModule extends EndgeModule {}

    const federationId = uniqueFederationId('shared-facade')
    const FirstFacade = EndgeFederation.define({
      id: federationId,
      modules: [
        { key: 'base', create: () => new TestModule() },
      ],
    })
    const SecondFacade = EndgeFederation.define({
      id: federationId,
      modules: [
        { key: 'base', create: () => new TestModule() },
      ],
    })

    FirstFacade.use({
      id: 'shared-extension',
      modules: [
        { key: 'extension', create: () => new TestModule() },
      ],
    })

    void SecondFacade.state
    await FirstFacade.boot(createBootContext())

    const secondExtension = (SecondFacade as typeof SecondFacade & { readonly extension: TestModule }).extension
    expect(secondExtension).toBe(FirstFacade.getModule('extension'))
  })

  /** Проверяет рекурсивную валидацию graph до первого lifecycle side effect. */
  it('не начинает root lifecycle при некорректном graph дочерней федерации', async () => {
    const calls: string[] = []

    class RootModule extends EndgeModule {
      public override setup(): void {
        calls.push('root:setup')
      }
    }

    const BrokenChild = EndgeFederation.define({
      id: uniqueFederationId('broken-child'),
      modules: [
        { key: 'inside', create: () => new RootModule(), after: 'missing' },
      ],
    })
    const Parent = EndgeFederation.define({
      id: uniqueFederationId('validated-parent'),
      modules: [
        { key: 'root', create: () => new RootModule() },
      ],
      federations: [
        { key: 'child', federation: BrokenChild, after: 'root' },
      ],
    })

    expect(() => Parent.boot(createBootContext())).toThrow('references unknown node "missing"')
    expect(calls).toEqual([])
    expect(Parent.state).toBe('idle')
  })

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
