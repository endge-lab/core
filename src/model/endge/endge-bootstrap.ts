import type { AppBootstrapOptions, BootstrapEvent, BootstrapStep, BootstrapStepName } from '@/domain/types/bootstrap.types'
import { EndgeModule } from '@/domain/entities/endge/EndgeModule'

export class EndgeBootstrap extends EndgeModule {
  private readonly strict: boolean
  private readonly onEvent?: (e: BootstrapEvent) => void

  private readonly steps: Map<BootstrapStepName, BootstrapStep> = new Map()
  private readonly done: Set<BootstrapStepName> = new Set()
  private readonly inFlight: Map<BootstrapStepName, Promise<void>> = new Map()

  public constructor(options?: AppBootstrapOptions) {
    super()
    this.strict = options?.strict ?? true
    this.onEvent = options?.onEvent
  }

  public registerStep(step: BootstrapStep): void {
    this.steps.set(step.name, step)
  }

  public registerSteps(steps: readonly BootstrapStep[]): void {
    for (const s of steps) this.registerStep(s)
  }

  public async run(requestedSteps: readonly BootstrapStepName[]): Promise<void> {
    const requested: BootstrapStepName[] = this.unique(requestedSteps)

    this.onEvent?.({ type: 'bootstrap:start', steps: requested })

    const expanded: BootstrapStepName[] = this.expandWithDependencies(requested)

    this.onEvent?.({ type: 'bootstrap:plan', requested, expanded })

    for (const name of expanded) {
      await this.runOnce(name)
    }

    this.onEvent?.({ type: 'bootstrap:done', steps: expanded })
  }

  public reset(): void {
    this.done.clear()
    this.inFlight.clear()
  }

  public invalidate(steps: readonly BootstrapStepName[]): void {
    for (const s of steps) this.done.delete(s)
  }

  public markDone(steps: readonly BootstrapStepName[]): void {
    for (const s of steps) this.done.add(s)
  }

  public isDone(step: BootstrapStepName): boolean {
    return this.done.has(step)
  }

  /**
   * Internals
   */
  private expandWithDependencies(requested: readonly BootstrapStepName[]): BootstrapStepName[] {
    const ordered: BootstrapStepName[] = []
    const visiting: Set<BootstrapStepName> = new Set()
    const visited: Set<BootstrapStepName> = new Set()

    const visit = (name: BootstrapStepName): void => {
      if (visited.has(name))
        return
      if (visiting.has(name)) {
        throw new Error(`[AppBootstrap] Cyclic dependency detected at step: ${name}`)
      }

      const step: BootstrapStep | undefined = this.steps.get(name)
      if (!step) {
        if (this.strict)
          throw new Error(`[AppBootstrap] Unknown step requested: ${name}`)
        return
      }

      visiting.add(name)

      const deps: readonly BootstrapStepName[] = step.dependsOn ?? []
      for (const dep of deps) {
        visit(dep)
      }

      visiting.delete(name)
      visited.add(name)
      ordered.push(name)
    }

    for (const s of requested) visit(s)

    return this.unique(ordered)
  }

  private async runOnce(name: BootstrapStepName): Promise<void> {
    if (this.done.has(name)) {
      this.onEvent?.({ type: 'step:skip', step: name })
      return
    }

    const existing: Promise<void> | undefined = this.inFlight.get(name)
    if (existing) {
      await existing
      return
    }

    const step: BootstrapStep | undefined = this.steps.get(name)
    if (!step) {
      if (this.strict)
        throw new Error(`[AppBootstrap] Step not registered: ${name}`)
      return
    }

    this.onEvent?.({ type: 'step:start', step: name })
    const startedAt: number = Date.now()

    const p: Promise<void> = (async () => {
      await step.run()
      this.done.add(name)
      this.inFlight.delete(name)
      this.onEvent?.({ type: 'step:done', step: name, ms: Date.now() - startedAt })
    })().catch((error: unknown) => {
      this.inFlight.delete(name)
      this.onEvent?.({ type: 'step:error', step: name, error })
      throw error
    })

    this.inFlight.set(name, p)
    await p
  }

  private unique<T>(arr: readonly T[]): T[] {
    return Array.from(new Set(arr))
  }
}
