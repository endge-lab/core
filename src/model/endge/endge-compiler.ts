import type { EndgeBootContext } from '@/domain/types/bootstrap.types'
import type {
  ComponentSFCProgramPayload,
  EntityCompilerHandler,
  ProgramArtifact,
  ProgramArtifactRef,
  ProgramCapability,
  ProgramCompileContext,
  ProgramDiagnostic,
  ProgramEntityType,
  QueryProgramPayload,
} from '@/domain/types/program.types'

import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import { RComponentSFC } from '@/domain/entities/reflect/RComponentSFC'
import { RQuery } from '@/domain/entities/reflect/RQuery'
import { compileComponentSFC } from '@/domain/services/compiler/component-sfc-compile'
import { ENDGE_COMPILER_VERSION } from '@/model/config/compiler'
import { ENDGE_LOG_LANES } from '@/model/config/debug'
import { Endge } from '@/model/endge/endge'

/**
 * Компилятор persisted domain model в compiled program artifacts.
 */
export class EndgeCompiler extends EndgeModule {
  private readonly handlers = new Map<ProgramEntityType, EntityCompilerHandler<any, any>>()

  /**
   * Создает singleton-bound compiler module и регистрирует стандартные handlers.
   *
   * Регистрация выполняется один раз при создании модуля, чтобы build-фаза
   * только запускала pipeline и не пересобирала таблицу обработчиков.
   */
  constructor() {
    super()
    this.registerDefaultHandlers()
  }

  /**
   * Lifecycle-точка входа компилятора.
   *
   * На build-фазе читает текущий `Endge.domain`, очищает/начинает новый
   * `Endge.program` compile cycle и строит artifacts для сущностей.
   */
  public override build(_ctx: EndgeBootContext): void {
    const dbg = Endge.debug
    const context: ProgramCompileContext = { compilerVersion: ENDGE_COMPILER_VERSION }

    Endge.program.beginCompile(ENDGE_COMPILER_VERSION)
    dbg.startTrace('compile', 'info')

    if (!this.compilePhase('component-sfc', ENDGE_LOG_LANES.COMPONENTS, 'SFC-компонентов', Endge.domain.getComponentSFCs(), context))
      return

    if (!this.compilePhase('query', ENDGE_LOG_LANES.QUERIES, 'query source', Endge.domain.getQueries(), context))
      return

    dbg.info('Проект успешно скомпилирован', { icon: 'ti ti-check text-xl' })
    dbg.endTrace('info', { status: 'success' })
  }

  /**
   * Регистрирует handler компиляции для поддерживаемого program entity.
   *
   * Сейчас используется только для встроенной SFC-регистрации.
   */
  private registerHandler<TEntity, TPayload>(handler: EntityCompilerHandler<TEntity, TPayload>): void {
    this.handlers.set(handler.entityType, handler as EntityCompilerHandler<any, any>)
  }

  /**
   * Компилирует однотипную фазу доменных сущностей через зарегистрированный handler.
   *
   * Метод отвечает за единый debug span, обработку ошибок и перевод
   * `Endge.program` в error status при неуспешной фазе.
   */
  private compilePhase<TEntity>(
    entityType: ProgramEntityType,
    lane: string,
    title: string,
    entities: TEntity[],
    context: ProgramCompileContext,
    failTraceOnError = true,
  ): boolean {
    const dbg = Endge.debug
    dbg.startSpan(lane, 'compile', 'info')
    dbg.info(`Начата компиляция ${title}`)

    try {
      for (const entity of entities)
        this.compileEntity(entityType, entity, context)

      dbg.info(`Компиляция ${title} успешно завершена`, { icon: 'ti ti-check text-xl' })
      dbg.endSpan('info')
      return true
    }
    catch (e: any) {
      dbg.error(`Ошибка компиляции ${title}: ${e?.message ?? e}`, { error: e })
      dbg.error('action: alert', { icon: 'ti ti-alert-triangle text-xl' })
      dbg.endSpan('error')
      if (failTraceOnError)
        dbg.endTrace('error')
      Endge.program.setStatus('error')
      return false
    }
  }

  /**
   * Компилирует одну доменную сущность и добавляет artifact в активный `Endge.program`.
   *
   * Само преобразование делегируется handler-у, зарегистрированному для
   * конкретного `ProgramEntityType`.
   */
  private compileEntity<TEntity>(
    entityType: ProgramEntityType,
    entity: TEntity,
    context: ProgramCompileContext,
  ): ProgramArtifact {
    const handler = this.handlers.get(entityType)
    if (!handler)
      throw new Error(`Compiler handler is not registered for "${entityType}"`)

    return Endge.program.addArtifact(handler.compile(entity, context))
  }

  /**
   * Регистрирует built-in handlers для SFC-компонентов.
   *
   * Сейчас compiler сознательно строит program artifacts только для новой
   * source-first ветки `component-sfc`.
   */
  private registerDefaultHandlers(): void {
    this.registerHandler<RComponentSFC, ComponentSFCProgramPayload>({
      entityType: 'component-sfc',
      compile: (entity, context) => {
        const result = compileComponentSFC(entity.source)
        return this._makeArtifact(entity, 'component-sfc', context, {
          capabilities: ['compilable', 'runnable', 'renderable'],
          payload: {
            sourceParts: result.sourceParts,
            contract: result.contract,
            dependencies: result.dependencies,
            runtimeDependencies: result.runtimeDependencies,
            previewProps: result.previewProps,
            ast: result.ast,
            ir: result.ir,
          },
          diagnostics: result.diagnostics,
        })
      },
    })

    this.registerHandler<RQuery, QueryProgramPayload>({
      entityType: 'query',
      compile: (entity, context) => {
        const source = this._resolveQuerySource(entity)
        const result = Endge.source.compile('query', source)
        const artifact = result.artifact as QueryProgramPayload | undefined

        return this._makeArtifact(entity, 'query', context, {
          capabilities: ['compilable', 'runnable', 'data-provider'],
          payload: {
            ...this._makeEmptyQueryPayload(),
            ...(artifact ?? {}),
            ast: result.ast ?? null,
            sourceDocument: result.document ?? null,
          },
          diagnostics: (result.diagnostics ?? []) as Omit<ProgramDiagnostic, 'entityRef'>[],
        })
      },
    })
  }

  /**
   * Создает унифицированный `ProgramArtifact` из доменной сущности и payload.
   *
   * Метод централизует ref, source hash, diagnostics, status, capabilities
   * и compiler version, чтобы handlers описывали только payload-специфику.
   */
  private _makeArtifact<TEntity, TPayload>(
    entity: TEntity,
    entityType: ProgramEntityType,
    context: ProgramCompileContext,
    options: {
      payload: TPayload
      capabilities: ProgramCapability[]
      dependencies?: ProgramArtifact<TPayload>['dependencies']
      diagnostics?: Omit<ProgramDiagnostic, 'entityRef'>[]
    },
  ): ProgramArtifact<TPayload> {
    const ref = this._makeRef(entity, entityType)
    const diagnostics = [
      ...this._collectValidationDiagnostics(entity),
      ...(options.diagnostics ?? []),
    ].map(diagnostic => ({ ...diagnostic, entityRef: ref }))
    const status = diagnostics.some(diagnostic => diagnostic.severity === 'error')
      ? 'error'
      : (diagnostics.length ? 'warning' : 'valid')

    return {
      ref,
      sourceHash: this._hashString(JSON.stringify(this._toStableSource(entity))),
      compilerVersion: context.compilerVersion,
      status,
      diagnostics,
      dependencies: options.dependencies ?? [],
      capabilities: options.capabilities,
      payload: options.payload,
    }
  }

  /**
   * Строит стабильную ссылку artifact на исходную доменную сущность.
   *
   * Ref используется diagnostics, indexes и read-model lookups.
   */
  private _makeRef(entity: any, entityType: ProgramEntityType): ProgramArtifactRef {
    const id = entity?.id ?? entity?.identity ?? entity?.name ?? ''
    const identity = String(entity?.identity ?? entity?.name ?? id)
    return { entityType, id, identity }
  }

  /**
   * Переносит legacy validation errors сущности в diagnostics artifact.
   *
   * Старые ошибки пока считаются warning-ами, чтобы не ломать совместимость
   * существующих моделей, которые уже могли содержать validation noise.
   */
  private _collectValidationDiagnostics(entity: any): Omit<ProgramDiagnostic, 'entityRef'>[] {
    const errors = Array.isArray(entity?.validationErrors)
      ? entity.validationErrors as unknown[]
      : []
    return errors.map((message, index) => ({
      severity: 'warning',
      code: `validation.${index + 1}`,
      message: String(message),
    }))
  }

  /**
   * Формирует стабильный input для hash-а artifact.
   *
   * Сюда входят только поля, изменение которых должно инвалидировать
   * compiled artifact на уровне program read-model.
   */
  private _toStableSource(entity: any): unknown {
    return {
      id: entity?.id ?? null,
      identity: entity?.identity ?? null,
      name: entity?.name ?? null,
      type: entity?.type ?? null,
      kind: entity?.kind ?? null,
      source: entity?.source ?? null,
      sourceVersion: entity?.sourceVersion ?? null,
      endpoint: entity?.endpoint ?? null,
      query: entity?.query ?? null,
      method: entity?.method ?? null,
      headers: entity?.headers ?? null,
      auth: entity?.auth ?? null,
      params: entity?.params ? Array.from(entity.params.entries?.() ?? []) : null,
      filterMode: entity?.filterMode ?? null,
      filters: entity?.filters ?? null,
      subField: entity?.subField ?? null,
      returnField: entity?.returnField ?? null,
      mockData: entity?.mockData ?? null,
      mockDataEnabled: entity?.mockDataEnabled ?? null,
      definition: entity?.definition ?? null,
      updatedAt: entity?.updatedAt ?? null,
    }
  }

  /** Возвращает сохраненный query source или генерирует его из legacy полей. */
  private _resolveQuerySource(entity: RQuery): string {
    const source = typeof entity.source === 'string' ? entity.source.trim() : ''
    if (source)
      return source

    const generated = Endge.source.generate('query', entity)
    if (!generated.ok || !generated.source)
      throw new Error(generated.message ?? `Failed to generate query source for "${entity.identity ?? entity.name}"`)

    return generated.source
  }

  /** Создает пустой query payload для error-artifact. */
  private _makeEmptyQueryPayload(): QueryProgramPayload {
    return {
      type: 'query-rest',
      endpoint: '',
      query: '',
      subField: 'items',
      params: {},
      returnField: null,
      filters: [],
    }
  }

  /**
   * Возвращает короткий deterministic hash для source snapshot artifact.
   *
   * Hash не является криптографическим; он нужен только как дешевый marker
   * изменения входных данных компиляции.
   */
  private _hashString(value: string): string {
    let hash = 0
    for (let index = 0; index < value.length; index += 1)
      hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0
    return Math.abs(hash).toString(36)
  }
}
