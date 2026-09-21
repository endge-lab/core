import type { VoidFunction } from '@endge/utils'

export class EndgeSlotRegistry<T extends { id?: string }> {
  private _items: T[] = []
  private _byId = new Map<string, T>()
  private _listeners = new Set<() => void>()

  add(item: T): VoidFunction {
    this._items.push(item)
    if (item.id) {
      this._byId.set(item.id, item)
    }
    this._emit()
    return () => this.remove(item)
  }

  remove(item: T): void {
    this._items = this._items.filter(i => i !== item)
    if (item.id) {
      this._byId.delete(item.id)
    }
    this._emit()
  }

  list(): readonly T[] {
    return this._items
  }

  get(id: string): T | undefined {
    return this._byId.get(id)
  }

  subscribe(cb: () => void): VoidFunction {
    this._listeners.add(cb)
    return () => this._listeners.delete(cb)
  }

  private _emit(): void {
    for (const l of this._listeners) {
      l()
    }
  }
}
