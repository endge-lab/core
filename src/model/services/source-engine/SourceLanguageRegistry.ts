import type { SourceKind, SourceLanguageStrategy } from '@/domain/types/source-engine.types'

/** Реестр source language strategies для editor-facing операций. */
export class SourceLanguageRegistry {
  private readonly _strategies: SourceLanguageStrategy[] = []

  /** Регистрирует language strategy. Повторная регистрация с тем же id заменяет старую. */
  public register(strategy: SourceLanguageStrategy): void {
    const index = this._strategies.findIndex(item => item.id === strategy.id)
    if (index >= 0)
      this._strategies[index] = strategy
    else
      this._strategies.push(strategy)
  }

  /** Возвращает копию зарегистрированных language strategies для debug/UI. */
  public list(): SourceLanguageStrategy[] {
    return [...this._strategies]
  }

  /** Возвращает language strategy, которая обслуживает указанный source-kind. */
  public resolve(sourceKind: SourceKind | string): SourceLanguageStrategy | null {
    for (const strategy of this._strategies) {
      if (strategy.supports(sourceKind))
        return strategy
    }

    return null
  }
}
