import { describe, expect, it } from 'vitest'
import { EndgeFederation } from '@/features/federation/EndgeFederation'
import { EndgeModule } from '@/features/federation/EndgeModule'

class TrackedModule extends EndgeModule {
  public calls: string[] = []
  public failReset = false
  public override setup(): void { this.calls.push('setup') }
  public override start(): void { this.calls.push('start') }
  public override reset(): void {
    this.calls.push('reset')
    if (this.failReset) {
      throw new Error('reset failed')
    }
  }
}

describe('selected federation lifecycle', () => {
  it('keeps skipped modules untouched during boot, reset failure and reset retry', async () => {
    const selected = new TrackedModule()
    const skipped = new TrackedModule()
    const Root = EndgeFederation.define({
      id: `profile-root-${Math.random()}`,
      modules: [{ key: 'selected', create: () => selected }, { key: 'skipped', create: () => skipped }],
      selectLifecycleNodes: nodes => nodes.filter(node => node.key === 'selected'),
    })
    await Root.boot({})
    selected.failReset = true
    await expect(Root.reset()).rejects.toThrow('reset was incomplete')
    selected.failReset = false
    await Root.reset()
    expect(selected.calls).toEqual(['setup', 'start', 'reset', 'reset'])
    expect(skipped.calls).toEqual([])
  })

  it('honors an empty profile in an attached federation including cleanup', async () => {
    const skipped = new TrackedModule()
    const Child = EndgeFederation.define({
      id: `profile-child-${Math.random()}`,
      modules: [{ key: 'skipped', create: () => skipped }],
      selectLifecycleNodes: () => [],
    })
    const Root = EndgeFederation.define({
      id: `profile-parent-${Math.random()}`,
      modules: [],
      federations: [{ key: 'child', federation: Child }],
    })
    await Root.boot({})
    await Root.reset()
    expect(skipped.calls).toEqual([])
  })
})
