export type BootstrapStepName = string

export interface BootstrapStep {
  name: BootstrapStepName
  run: () => Promise<void>
  dependsOn?: readonly BootstrapStepName[]
}

export type BootstrapEvent
  = | { type: 'bootstrap:start', steps: BootstrapStepName[] }
    | { type: 'bootstrap:plan', requested: BootstrapStepName[], expanded: BootstrapStepName[] }
    | { type: 'step:skip', step: BootstrapStepName }
    | { type: 'step:start', step: BootstrapStepName }
    | { type: 'step:done', step: BootstrapStepName, ms: number }
    | { type: 'step:error', step: BootstrapStepName, error: unknown }
    | { type: 'bootstrap:done', steps: BootstrapStepName[] }

export interface AppBootstrapOptions {
  strict?: boolean
  onEvent?: (e: BootstrapEvent) => void
}
