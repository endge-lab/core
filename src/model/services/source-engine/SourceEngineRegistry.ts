import type { SourceEngineStrategy, SourceKind } from '@/domain/types/source/source-engine.types'

/** Реестр source engine strategies, выбирающий обработчик по source-kind. */
export class SourceEngineRegistry {
  private readonly _strategies: SourceEngineStrategy[] = []

  /** Регистрирует стратегию. Повторная регистрация с тем же id заменяет старую. */
  public register(strategy: SourceEngineStrategy): void {
    const index = this._strategies.findIndex(item => item.id === strategy.id)
    if (index >= 0)
      this._strategies[index] = strategy
    else
      this._strategies.push(strategy)
  }

  /** Возвращает копию зарегистрированных стратегий для debug/UI. */
  public list(): SourceEngineStrategy[] {
    return [...this._strategies]
  }

  /** Возвращает стратегию, которая обслуживает указанный source-kind. */
  public resolve(sourceKind: SourceKind | string): SourceEngineStrategy | null {
    for (const strategy of this._strategies) {
      if (strategy.supports(sourceKind))
        return strategy
    }

    return null
  }
}
