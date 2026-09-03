import type { EndgeStorageAdapter } from '@/modules/context/domain/context-persistence.types'

export class LocalStorageContextAdapter implements EndgeStorageAdapter {
  public readonly id = 'local' as const

  public isAvailable(): boolean {
    return typeof localStorage !== 'undefined'
  }

  public read<T>(key: string): T | undefined {
    if (!this.isAvailable()) {
      return undefined
    }

    const raw = localStorage.getItem(key)
    if (!raw) {
      return undefined
    }

    return JSON.parse(raw) as T
  }

  /** Читает legacy raw string, который ещё не использовал JSON serialization. */
  public readRaw(key: string): string | null {
    if (!this.isAvailable()) {
      return null
    }
    return localStorage.getItem(key)
  }

  public write<T>(key: string, value: T): void {
    if (!this.isAvailable()) {
      return
    }

    localStorage.setItem(key, JSON.stringify(value))
  }

  public remove(key: string): void {
    if (!this.isAvailable()) {
      return
    }

    localStorage.removeItem(key)
  }
}
