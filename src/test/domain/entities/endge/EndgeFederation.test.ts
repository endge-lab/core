// @vitest-environment node
import type { EndgeBootContext } from '@/domain/types/kernel/bootstrap.types'

import { describe, expect, it } from 'vitest'

import { EndgeFederation } from '@/domain/entities/endge/EndgeFederation'
import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import { ENDGE_CORE_MODULES } from '@/model/config/modules.config'

function createBootContext(): EndgeBootContext {
  return {
    dataProvider: 'plain',
    scope: {},
    vars: {},
    plainSource: {},
  }
}

describe('endgeFederation stages', () => {
  it('runs module stages in registration order', async () => {
    const calls: string[] = []

    class TestModule extends EndgeModule {
      constructor(private readonly _key: string) {
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
    }

    class TestFederation extends EndgeFederation {
      protected static override readonly federationId = `test-stage-order-${Date.now()}-${Math.random()}`

      protected static override configureFederation(): void {
        this.defineModule({ key: 'first', module: new TestModule('first') })
        this.defineModule({ key: 'second', module: new TestModule('second') })
      }
    }

    const context = createBootContext()
    await TestFederation.boot(context)

    expect(calls).toEqual([
      'first:setup',
      'second:setup',
      'first:load',
      'second:load',
      'first:build',
      'second:build',
      'first:start',
      'second:start',
    ])
    expect(TestFederation.isInitialized).toBe(true)

    await TestFederation.boot(context)
    expect(calls).toHaveLength(8)
  })

  it('resets modules in reverse order and reports cleanup errors', async () => {
    const calls: string[] = []

    class ResetModule extends EndgeModule {
      constructor(
        private readonly _key: string,
        private readonly _shouldThrow: boolean = false,
      ) {
        super()
      }

      public override reset(): void {
        calls.push(`${this._key}:reset`)
        if (this._shouldThrow) {
          throw new Error('reset failed')
        }
      }
    }

    class TestFederation extends EndgeFederation {
      protected static override readonly federationId = `test-reset-order-${Date.now()}-${Math.random()}`

      protected static override configureFederation(): void {
        this.defineModule({ key: 'first', module: new ResetModule('first', true) })
        this.defineModule({ key: 'second', module: new ResetModule('second') })
      }
    }

    await expect(TestFederation.reset()).rejects.toBeInstanceOf(AggregateError)
    expect(calls).toEqual(['second:reset', 'first:reset'])
    expect(TestFederation.state).toBe('failed')
  })

  it('reuses boot context for repeated lifecycle stages', async () => {
    const calls: string[] = []

    class BuildModule extends EndgeModule {
      public override build(ctx: EndgeBootContext): void {
        calls.push(`build:${ctx.dataProvider}`)
      }
    }

    class TestFederation extends EndgeFederation {
      protected static override readonly federationId = `test-boot-context-${Date.now()}-${Math.random()}`

      protected static override configureFederation(): void {
        this.defineModule({ key: 'build', module: new BuildModule() })
      }
    }

    await TestFederation.boot(createBootContext())
    await TestFederation.build()

    expect(calls).toEqual(['build:plain', 'build:plain'])

    await TestFederation.reset()
    await expect(TestFederation.build()).rejects.toThrow('[TestFederation] boot context is not available')
  })

  it('orders constrained modules before their targets', async () => {
    const calls: string[] = []

    class TestModule extends EndgeModule {
      constructor(private readonly _key: string) {
        super()
      }

      public override start(): void {
        calls.push(this._key)
      }
    }

    class TestFederation extends EndgeFederation {
      protected static override readonly federationId = `test-before-order-${Date.now()}-${Math.random()}`

      protected static override configureFederation(): void {
        this.defineModule({ key: 'compiler', module: new TestModule('compiler') })
        this.defineModule({ key: 'runtime', module: new TestModule('runtime') })
        this.defineModule({ key: 'vars', module: new TestModule('vars') })
        this.defineModule({
          key: 'vue',
          module: new TestModule('vue'),
          before: 'runtime',
        })
      }

      public static async startForTest(ctx: EndgeBootContext): Promise<void> {
        await this.start(ctx)
      }
    }

    await TestFederation.startForTest(createBootContext())

    expect(calls).toEqual(['compiler', 'vue', 'runtime', 'vars'])
  })

  it('installs plugins during federation configuration', async () => {
    const calls: string[] = []

    class TestModule extends EndgeModule {
      constructor(private readonly _key: string) {
        super()
      }

      public override start(): void {
        calls.push(this._key)
      }
    }

    class TestFederation extends EndgeFederation {
      protected static override readonly federationId = `test-plugin-order-${Date.now()}-${Math.random()}`

      protected static override configureFederation(): void {
        this.defineModule({ key: 'runtime', module: new TestModule('runtime') })
      }

      public static async startForTest(ctx: EndgeBootContext): Promise<void> {
        await this.start(ctx)
      }
    }

    TestFederation.use({
      id: 'test.vue',
      install(): void {
        TestFederation.defineModule({
          key: 'vue',
          module: new TestModule('vue'),
          before: 'runtime',
        })
      },
    })

    await TestFederation.startForTest(createBootContext())

    expect(calls).toEqual(['vue', 'runtime'])
  })

  it('keeps schema before domain in core modules', () => {
    const keys = ENDGE_CORE_MODULES.map(item => item.key)

    expect(keys.indexOf('domainRepository')).toBeGreaterThanOrEqual(0)
    expect(keys.indexOf('domain')).toBeGreaterThanOrEqual(0)
    expect(keys.indexOf('workspace')).toBeGreaterThanOrEqual(0)
    expect(keys.indexOf('context')).toBeLessThan(keys.indexOf('workspace'))
    expect(keys.indexOf('domainRepository')).toBeLessThan(keys.indexOf('domain'))
    expect(keys.indexOf('domain')).toBeLessThan(keys.indexOf('compiler'))
    expect(keys.indexOf('compiler')).toBeLessThan(keys.indexOf('runtime'))
  })
})
