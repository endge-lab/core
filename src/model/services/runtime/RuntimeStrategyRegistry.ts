import type { AnyRuntimeStrategy } from '@/domain/types/runtime/runtime.types'

/** Реестр runtime strategy, которые EndgeRuntime использует вместо switch/if factory. */
export class RuntimeStrategyRegistry {
  private readonly _strategies: AnyRuntimeStrategy[] = []

  /** Регистрирует стратегию. Повторная регистрация с тем же id заменяет старую. */
  public register(strategy: AnyRuntimeStrategy): void {
    const index = this._strategies.findIndex(item => item.id === strategy.id)
    if (index >= 0)
      this._strategies[index] = strategy
    else
      this._strategies.push(strategy)
  }

  /** Возвращает копию списка стратегий для диагностики. */
  public list(): AnyRuntimeStrategy[] {
    return [...this._strategies]
  }

  /** Подбирает первую стратегию, которая поддерживает модель. */
  public resolve(model: unknown): AnyRuntimeStrategy | null {
    for (const strategy of this._strategies) {
      if (strategy.supports(model))
        return strategy
    }

    return null
  }
}
