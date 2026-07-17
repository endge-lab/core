export interface RuntimeOwnedResource {
  readonly id: string
  readonly kind: string
  pause?: () => Promise<void> | void
  resume?: () => Promise<void> | void
  dispose: () => Promise<void> | void
}

export interface RuntimeResourceBagSnapshot {
  total: number
  paused: boolean
  resources: Array<{ id: string, kind: string }>
}
