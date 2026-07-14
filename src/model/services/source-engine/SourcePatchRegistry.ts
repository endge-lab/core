import type { SourceKind, SourcePatchStrategy } from '@/domain/types/source/source-engine.types'

/** Реестр source patch strategies для editor-facing AST-патчинга. */
export class SourcePatchRegistry {
  private readonly _strategies: Array<SourcePatchStrategy<any, any>> = []

  /** Регистрирует patch strategy. Повторная регистрация с тем же id заменяет старую. */
  public register(strategy: SourcePatchStrategy<any, any>): void {
    const index = this._strategies.findIndex(item => item.id === strategy.id)
    if (index >= 0)
      this._strategies[index] = strategy
    else
      this._strategies.push(strategy)
  }

  /** Возвращает копию зарегистрированных patch strategies для debug/UI. */
  public list(): Array<SourcePatchStrategy<any, any>> {
    return [...this._strategies]
  }

  /** Возвращает patch strategy, которая обслуживает указанный source-kind. */
  public resolve(sourceKind: SourceKind | string): SourcePatchStrategy<any, any> | null {
    for (const strategy of this._strategies) {
      if (strategy.supports(sourceKind))
        return strategy
    }

    return null
  }
}
