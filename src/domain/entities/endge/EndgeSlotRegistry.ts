import type { VoidFunction } from '@endge/utils'

export class EndgeSlotRegistry<T extends { id?: string }> {
  private items: T[] = []
  private byId = new Map<string, T>()
  private listeners = new Set<() => void>()

  add(item: T): VoidFunction {
    this.items.push(item)
    if (item.id) this.byId.set(item.id, item)
    this.emit()
    return () => this.remove(item)
  }

  remove(item: T): void {
    this.items = this.items.filter((i) => i !== item)
    if (item.id) this.byId.delete(item.id)
    this.emit()
  }

  list(): readonly T[] {
    return this.items
  }

  get(id: string): T | undefined {
    return this.byId.get(id)
  }

  subscribe(cb: () => void): VoidFunction {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private emit(): void {
    for (const l of this.listeners) l()
  }
}
