import type {
  SourceEngineCompileResult,
  SourceEngineGenerateResult,
  SourceEngineStrategy,
  SourceLanguageCompletion,
  SourceLanguageContext,
  SourceLanguageStrategy,
  SourceLanguageValidationResult,
  SourceKind,
} from '@/domain/types/source-engine.types'

import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import { SourceEngineRegistry } from '@/domain/services/source-engine/SourceEngineRegistry'
import { SourceLanguageRegistry } from '@/domain/services/source-engine/SourceLanguageRegistry'
import { QuerySourceEngineStrategy } from '@/domain/services/source-engine/strategies/QuerySourceEngineStrategy'
import { QuerySourceLanguageStrategy } from '@/domain/services/source-engine/strategies/QuerySourceLanguageStrategy'

/** Модуль authoring-операций над source-документами Endge. */
export class EndgeSource extends EndgeModule {
  private readonly _strategies = new SourceEngineRegistry()
  private readonly _languageStrategies = new SourceLanguageRegistry()

  public constructor() {
    super()
    this._registerDefaultStrategies()
  }

  /** Регистрирует source strategy. Повторная регистрация с тем же id заменяет старую. */
  public registerStrategy(strategy: SourceEngineStrategy): void {
    this._strategies.register(strategy)
    this.notify()
  }

  /** Регистрирует source language strategy. Повторная регистрация с тем же id заменяет старую. */
  public registerLanguageStrategy(strategy: SourceLanguageStrategy): void {
    this._languageStrategies.register(strategy)
    this.notify()
  }

  /** Возвращает копию списка зарегистрированных source strategies. */
  public listStrategies(): SourceEngineStrategy[] {
    return this._strategies.list()
  }

  /** Возвращает копию списка зарегистрированных source language strategies. */
  public listLanguageStrategies(): SourceLanguageStrategy[] {
    return this._languageStrategies.list()
  }

  /** Возвращает стратегию для указанного source-kind. */
  public resolveStrategy(sourceKind: SourceKind | string): SourceEngineStrategy | null {
    return this._strategies.resolve(sourceKind)
  }

  /** Возвращает language strategy для указанного source-kind. */
  public resolveLanguageStrategy(sourceKind: SourceKind | string): SourceLanguageStrategy | null {
    return this._languageStrategies.resolve(sourceKind)
  }

  /** Генерирует source для указанного source-kind через зарегистрированную strategy. */
  public generate(sourceKind: SourceKind | string, model: unknown): SourceEngineGenerateResult {
    const strategy = this._resolveRequiredStrategy(sourceKind)
    if (!strategy.generate) {
      return {
        ok: false,
        message: `Source strategy "${strategy.id}" does not support generate().`,
      }
    }

    return strategy.generate(model)
  }

  /** Компилирует source указанного source-kind в normalized document и artifact payload. */
  public compile(sourceKind: SourceKind | string, source: string): SourceEngineCompileResult {
    const strategy = this._resolveRequiredStrategy(sourceKind)
    if (!strategy.compile) {
      return {
        ok: false,
        message: `Source strategy "${strategy.id}" does not support compile().`,
      }
    }

    return strategy.compile(source)
  }

  /** Возвращает базовый source для новой сущности указанного source-kind. */
  public createDefault(sourceKind: SourceKind | string): string {
    return this._resolveRequiredLanguageStrategy(sourceKind).createDefaultSource()
  }

  /** Валидирует source указанного source-kind для editor-facing сценариев. */
  public validate(sourceKind: SourceKind | string, source: string): SourceLanguageValidationResult {
    return this._resolveRequiredLanguageStrategy(sourceKind).validate(source)
  }

  /** Возвращает editor-facing completion items для указанного source-kind. */
  public completions(sourceKind: SourceKind | string, context: SourceLanguageContext): SourceLanguageCompletion[] {
    return this._resolveRequiredLanguageStrategy(sourceKind).completions(context)
  }

  /** Регистрирует встроенные strategies ядра. */
  private _registerDefaultStrategies(): void {
    this._strategies.register(new QuerySourceEngineStrategy())
    this._languageStrategies.register(new QuerySourceLanguageStrategy())
  }

  /** Возвращает strategy или бросает явную ошибку для некорректного source-kind. */
  private _resolveRequiredStrategy(sourceKind: SourceKind | string): SourceEngineStrategy {
    const strategy = this._strategies.resolve(sourceKind)
    if (!strategy)
      throw new Error(`Source strategy is not registered for "${sourceKind}".`)

    return strategy
  }

  /** Возвращает language strategy или бросает явную ошибку для некорректного source-kind. */
  private _resolveRequiredLanguageStrategy(sourceKind: SourceKind | string): SourceLanguageStrategy {
    const strategy = this._languageStrategies.resolve(sourceKind)
    if (!strategy)
      throw new Error(`Source language strategy is not registered for "${sourceKind}".`)

    return strategy
  }
}
