import type {
  SourceEngineCompileResult,
  SourceEngineGenerateResult,
  SourceEngineStrategy,
  SourceLanguageCompletion,
  SourceLanguageContext,
  SourceDocumentReference,
  SourceLanguageStrategy,
  SourceLanguageValidationResult,
  SourceKind,
  SourceParseResult,
  SourcePatchResult,
  SourcePatchStrategy,
} from '@/domain/types/source/source-engine.types'

import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import { SourceEngineRegistry } from '@/model/services/source-engine/SourceEngineRegistry'
import { SourceLanguageRegistry } from '@/model/services/source-engine/SourceLanguageRegistry'
import { SourcePatchRegistry } from '@/model/services/source-engine/SourcePatchRegistry'
import { DataViewSourceEngineStrategy } from '@/model/services/source-engine/strategies/DataViewSourceEngineStrategy'
import { DataViewSourceLanguageStrategy } from '@/model/services/source-engine/strategies/DataViewSourceLanguageStrategy'
import { FilterSourceEngineStrategy } from '@/model/services/source-engine/strategies/FilterSourceEngineStrategy'
import { FilterSourceLanguageStrategy } from '@/model/services/source-engine/strategies/FilterSourceLanguageStrategy'
import { CompositionSourceEngineStrategy } from '@/model/services/source-engine/strategies/CompositionSourceEngineStrategy'
import { CompositionSourceLanguageStrategy } from '@/model/services/source-engine/strategies/CompositionSourceLanguageStrategy'
import { QuerySourceEngineStrategy } from '@/model/services/source-engine/strategies/QuerySourceEngineStrategy'
import { QuerySourceLanguageStrategy } from '@/model/services/source-engine/strategies/QuerySourceLanguageStrategy'
import { QuerySourcePatchStrategy } from '@/model/services/source-engine/strategies/QuerySourcePatchStrategy'
import { StoreSourceEngineStrategy } from '@/model/services/source-engine/strategies/StoreSourceEngineStrategy'
import { StoreSourceLanguageStrategy } from '@/model/services/source-engine/strategies/StoreSourceLanguageStrategy'
import { ComputationSourceEngineStrategy } from '@/model/services/source-engine/strategies/ComputationSourceEngineStrategy'
import { ComputationSourceLanguageStrategy } from '@/model/services/source-engine/strategies/ComputationSourceLanguageStrategy'
import { StyleSourceEngineStrategy } from '@/model/services/source-engine/strategies/StyleSourceEngineStrategy'
import { StyleSourceLanguageStrategy } from '@/model/services/source-engine/strategies/StyleSourceLanguageStrategy'
import { TypeSourceEngineStrategy } from '@/model/services/source-engine/strategies/TypeSourceEngineStrategy'
import { TypeSourceLanguageStrategy } from '@/model/services/source-engine/strategies/TypeSourceLanguageStrategy'

/** Модуль authoring-операций над source-документами Endge. */
export class EndgeSource extends EndgeModule {
  private readonly _strategies = new SourceEngineRegistry()
  private readonly _languageStrategies = new SourceLanguageRegistry()
  private readonly _patchStrategies = new SourcePatchRegistry()

  /** Создаёт source-модуль и регистрирует встроенные strategies. */
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

  /** Регистрирует source patch strategy. Повторная регистрация с тем же id заменяет старую. */
  public registerPatchStrategy(strategy: SourcePatchStrategy): void {
    this._patchStrategies.register(strategy)
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

  /** Возвращает копию списка зарегистрированных source patch strategies. */
  public listPatchStrategies(): SourcePatchStrategy[] {
    return this._patchStrategies.list()
  }

  /** Возвращает стратегию для указанного source-kind. */
  public resolveStrategy(sourceKind: SourceKind | string): SourceEngineStrategy | null {
    return this._strategies.resolve(sourceKind)
  }

  /** Возвращает language strategy для указанного source-kind. */
  public resolveLanguageStrategy(sourceKind: SourceKind | string): SourceLanguageStrategy | null {
    return this._languageStrategies.resolve(sourceKind)
  }

  /** Возвращает patch strategy для указанного source-kind. */
  public resolvePatchStrategy(sourceKind: SourceKind | string): SourcePatchStrategy | null {
    return this._patchStrategies.resolve(sourceKind)
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

  /** Парсит source указанного source-kind в normalized editor document. */
  public parse<TDocument = unknown>(sourceKind: SourceKind | string, source: string): SourceParseResult<TDocument> {
    return this._resolveRequiredPatchStrategy(sourceKind).parse(source) as SourceParseResult<TDocument>
  }

  /** Патчит source указанного source-kind, сохраняя нетронутые участки авторского кода. */
  public patch<TPatch = unknown, TDocument = unknown>(
    sourceKind: SourceKind | string,
    source: string,
    patch: TPatch,
  ): SourcePatchResult<TDocument> {
    return this._resolveRequiredPatchStrategy(sourceKind).patch(source, patch) as SourcePatchResult<TDocument>
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

  /** Возвращает семантическую ссылку на внешний документ под курсором. */
  public referenceAt(sourceKind: SourceKind | string, context: SourceLanguageContext): SourceDocumentReference | null {
    return this._resolveRequiredLanguageStrategy(sourceKind).resolveReference?.(context) ?? null
  }

  /** Регистрирует встроенные strategies ядра. */
  private _registerDefaultStrategies(): void {
    this._strategies.register(new QuerySourceEngineStrategy())
    this._strategies.register(new DataViewSourceEngineStrategy())
    this._strategies.register(new FilterSourceEngineStrategy())
    this._strategies.register(new CompositionSourceEngineStrategy())
    this._strategies.register(new StoreSourceEngineStrategy())
    this._strategies.register(new ComputationSourceEngineStrategy())
    this._strategies.register(new StyleSourceEngineStrategy())
    this._strategies.register(new TypeSourceEngineStrategy())
    this._languageStrategies.register(new QuerySourceLanguageStrategy())
    this._languageStrategies.register(new DataViewSourceLanguageStrategy())
    this._languageStrategies.register(new FilterSourceLanguageStrategy())
    this._languageStrategies.register(new CompositionSourceLanguageStrategy())
    this._languageStrategies.register(new StoreSourceLanguageStrategy())
    this._languageStrategies.register(new ComputationSourceLanguageStrategy())
    this._languageStrategies.register(new StyleSourceLanguageStrategy())
    this._languageStrategies.register(new TypeSourceLanguageStrategy())
    this._patchStrategies.register(new QuerySourcePatchStrategy())
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

  /** Возвращает patch strategy или бросает явную ошибку для некорректного source-kind. */
  private _resolveRequiredPatchStrategy(sourceKind: SourceKind | string): SourcePatchStrategy {
    const strategy = this._patchStrategies.resolve(sourceKind)
    if (!strategy)
      throw new Error(`Source patch strategy is not registered for "${sourceKind}".`)

    return strategy
  }
}
