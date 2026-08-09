import type { EndgeStorageAdapter } from '@/domain/types/runtime/context-persistence.types'

export class DisabledContextAdapter implements EndgeStorageAdapter {
  public readonly id = 'disabled' as const

  public isAvailable(): boolean {
    return false
  }

  public read<T>(_key: string): T | undefined {
    return undefined
  }

  public write<T>(_key: string, _value: T): void {
    // noop
  }

  public remove(_key: string): void {
    // noop
  }
}
