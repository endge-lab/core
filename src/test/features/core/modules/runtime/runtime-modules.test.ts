import type { ModuleArtifact, ScopedModuleContext } from '@/features/core/modules/runtime/module/module-artifact'
import { describe, expect, it } from 'vitest'
import { createLocalModuleLoader } from '@/features/core/modules/runtime/module/module-artifact'
import { RuntimeModules } from '@/features/core/modules/runtime/module/RuntimeModules'
import { RuntimeScope } from '@/features/core/modules/runtime/RuntimeScope'
import { compileCompositionSource } from '@/features/core/modules/source/services/compilers/composition-source-compile'
import { EndgeModule } from '@/features/federation/EndgeModule'

const moduleRef = (version: string) => ({ identity: 'slot-ui', version })
const first = moduleRef('1.0.0')
const second = moduleRef('1.0.1-dev.1')
const broken = moduleRef('1.0.2')

function example(label: string, events: string[], fail = false): ModuleArtifact {
  return {
    create: () => new class extends EndgeModule<ScopedModuleContext> {
      override setup(ctx: ScopedModuleContext) {
        events.push(`setup:${label}`)
        ctx.register('visual', 'Table', label)
        if (label === 'v1') {
          ctx.register('visual', 'TimelineOnlyInV1', label)
        }
      }

      override load() { events.push(`load:${label}`) }
      override build() { events.push(`build:${label}`) }
      override start() {
        events.push(`start:${label}`)
        if (fail) {
          throw new Error('Slot failed to start')
        }
      }

      pause() { events.push(`pause:${label}`) }
      resume() { events.push(`resume:${label}`) }
      override reset() { events.push(`reset:${label}`) }
    }(),
  }
}

describe('composition modules', () => {
  it('chooses a fixed version with contextSwitch and compiles a nested override', () => {
    const source = `defineComposition({
      resources: {
        slotUi: contextSwitch({
          default: module('slot-ui', '1.0.0'),
          cases: [{ when: { deployment: 'test' }, use: module('slot-ui', '1.0.1-dev.1') }],
        }),
      },
      runtimes: {
        review: scope({
          resources: { slotUi: module('slot-ui', '1.0.0') },
          runtimes: {},
        }),
      },
    })`
    const fallback = compileCompositionSource(source)
    const test = compileCompositionSource(source, 1, { deployment: 'test' })
    expect(test.diagnostics).toEqual([])
    expect(fallback.artifact?.resources).toMatchObject([{ ...first, path: 'slotUi' }, { ...first, path: 'review.slotUi' }])
    expect(test.artifact?.resources).toMatchObject([{ ...second, path: 'slotUi' }, { ...first, path: 'review.slotUi' }])
    expect(compileCompositionSource(source.replace('1.0.1-dev.1', '^1.0.0')).diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'composition-resource-module' }),
    ]))
  })

  it('inherits the nearest whole attachment and mounts two instances of a version independently', async () => {
    const events: string[] = []
    const modules = new RuntimeModules()
    modules.setup(createLocalModuleLoader([{ reference: first, artifact: example('v1', events) }, { reference: second, artifact: example('v2', events) }]))
    const root: RuntimeScope = new RuntimeScope({ id: 'root', path: 'root', hooks: { activate: () => modules.attach(root, 'slotUi', first) } })
    const review: RuntimeScope = new RuntimeScope({ id: 'review', path: 'review', parent: root, hooks: { activate: () => modules.attach(review, 'slotUi', second) } })
    const overview = new RuntimeScope({ id: 'overview', path: 'overview', parent: root })
    await overview.activate()
    await review.activate()
    expect(events).toEqual(['setup:v1', 'load:v1', 'build:v1', 'start:v1', 'setup:v2', 'load:v2', 'build:v2', 'start:v2'])
    expect(modules.resolve(overview, 'visual', 'Table')?.value).toBe('v1')
    expect(modules.resolve(review, 'visual', 'Table')?.value).toBe('v2')
    expect(modules.resolve(review, 'visual', 'TimelineOnlyInV1')).toBeUndefined()

    await modules.replace(review, 'slotUi', first)
    expect(modules.resolve(review, 'visual', 'Table')?.visualToken).not.toBe(modules.resolve(overview, 'visual', 'Table')?.visualToken)
    await review.deactivate()
    expect(events.filter(event => event === 'reset:v1')).toHaveLength(1)
    expect(modules.resolve(overview, 'visual', 'Table')?.value).toBe('v1')
    expect(modules.resolve(review, 'visual', 'Table')?.value).toBe('v1')
    await root.dispose()
    expect(modules.resolve(overview, 'visual', 'Table')).toBeUndefined()
  })

  it('keeps the last version active on preparation failure and releases it after the next commit', async () => {
    const events: string[] = []
    const modules = new RuntimeModules()
    modules.setup(createLocalModuleLoader([
      { reference: first, artifact: example('v1', events) },
      { reference: second, artifact: example('v2', events) },
      { reference: broken, artifact: example('broken', events, true) },
    ]))
    const scope: RuntimeScope = new RuntimeScope({ id: 'root', path: 'root', hooks: { activate: () => modules.attach(scope, 'slotUi', first) } })
    const off = modules.subscribe(() => events.push(`active:${modules.resolve(scope, 'visual', 'Table')?.value ?? '-'}`))
    await scope.activate()
    await scope.pause()
    await scope.resume()
    expect(events).toContain('pause:v1')
    expect(events).toContain('resume:v1')
    await expect(modules.replace(scope, 'slotUi', broken)).rejects.toThrow('Slot failed')
    expect(modules.resolve(scope, 'visual', 'Table')?.value).toBe('v1')
    expect(events).toContain('reset:broken')
    expect(events).not.toContain('reset:v1')
    await modules.replace(scope, 'slotUi', second)
    expect(events.indexOf('active:v2')).toBeLessThan(events.indexOf('reset:v1'))
    await scope.dispose()
    expect(events).toContain('reset:v2')
    expect(scope.resources.snapshot().total).toBe(0)
    off()
  })

  it('cancels an in-flight replacement when the scope is deactivated', async () => {
    const events: string[] = []
    const modules = new RuntimeModules()
    modules.setup(async (reference, signal) => {
      if (reference.version === first.version) {
        return example('v1', events)
      }
      if (signal.aborted) {
        throw signal.reason
      }
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })
    const scope: RuntimeScope = new RuntimeScope({ id: 'root', path: 'root', hooks: { activate: () => modules.attach(scope, 'slotUi', first) } })
    await scope.activate()
    const replacing = expect(modules.replace(scope, 'slotUi', second)).rejects.toMatchObject({ name: 'AbortError' })
    await scope.deactivate()
    await replacing
    expect(modules.resolve(scope, 'visual', 'Table')).toBeUndefined()
    expect(events).toContain('reset:v1')
  })

  it('releases the active module while a cancelled source is still responding', async () => {
    const events: string[] = []
    const modules = new RuntimeModules()
    let deliver!: (artifact: ModuleArtifact) => void
    const pendingSource = new Promise<ModuleArtifact>(resolve => deliver = resolve)
    let signalFromLoader: AbortSignal | undefined
    modules.setup(async (reference, signal) => {
      if (reference.version === first.version) {
        return example('v1', events)
      }
      signalFromLoader = signal
      return pendingSource
    })
    const scope: RuntimeScope = new RuntimeScope({ id: 'root', path: 'root', hooks: { activate: () => modules.attach(scope, 'slotUi', first) } })
    await scope.activate()
    const replacement = expect(modules.replace(scope, 'slotUi', second)).rejects.toMatchObject({ name: 'AbortError' })
    await Promise.resolve()
    expect(signalFromLoader?.aborted).toBe(false)
    await scope.deactivate()
    expect(events).toContain('reset:v1')
    expect(signalFromLoader?.aborted).toBe(true)
    deliver(example('v2', events))
    await replacement
    expect(events).not.toContain('setup:v2')
  })
})
