import type { EndgeBootContext } from '@/domain/types/bootstrap.types'
import type { DataViewMaterializationStrategy, DataViewRef, DataViewPipelineStep } from '@/domain/types/data-view-source.types'
import type { FilterProgramPayload } from '@/domain/types/filter-source.types'
import type { CompositionProgramPayload } from '@/domain/types/composition-source.types'
import type {
  ComponentSFCProgramPayload,
  DataViewProgramPayload,
  EntityCompilerHandler,
  ProgramArtifact,
  ProgramArtifactRef,
  ProgramCapability,
  ProgramCompileContext,
  ProgramDiagnostic,
  ProgramEntityType,
  QueryProgramPayload,
  QueryProgramOutput,
} from '@/domain/types/program.types'

import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import { RComponentSFC } from '@/domain/entities/reflect/RComponentSFC'
import { RDataView } from '@/domain/entities/reflect/RDataView'
import { RQuery } from '@/domain/entities/reflect/RQuery'
import { RFilter } from '@/domain/entities/reflect/RFilter'
import { RComposition } from '@/domain/entities/reflect/RComposition'
import { compileComponentSFC } from '@/domain/services/compiler/component-sfc-compile'
import { ENDGE_COMPILER_VERSION } from '@/model/config/compiler'
import { ENDGE_LOG_LANES } from '@/model/config/debug'
import { Endge } from '@/model/endge/endge'

/**
 * Компилятор persisted domain model в compiled program artifacts.
 */
export class EndgeCompiler extends EndgeModule {
  private readonly handlers = new Map<ProgramEntityType, EntityCompilerHandler<any, any>>()
  private _localDataViewCounter = 0
  private _localFilterCounter = 0

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

    if (!this.compilePhase('data-view', ENDGE_LOG_LANES.QUERIES, 'data views', Endge.domain.getDataViews(), context))
      return

    if (!this.compilePhase('filter', ENDGE_LOG_LANES.QUERIES, 'filter source', Endge.domain.getFilters(), context))
      return

    if (!this.compilePhase('query', ENDGE_LOG_LANES.QUERIES, 'query source', Endge.domain.getQueries(), context))
      return

    if (!this.compilePhase('composition', ENDGE_LOG_LANES.COMPONENTS, 'compositions', Endge.domain.getCompositions(), context))
      return

    dbg.info('Проект успешно скомпилирован', { icon: 'ti ti-check text-xl' })
    dbg.endTrace('info', { status: 'success' })
  }

  /** Компилирует один query source в Endge.program без запуска остальных compiler-фаз. */
  public buildQuery(entity: RQuery): ProgramArtifact<QueryProgramPayload> {
    const context: ProgramCompileContext = { compilerVersion: ENDGE_COMPILER_VERSION }
    return this.compileEntity('query', entity, context) as ProgramArtifact<QueryProgramPayload>
  }

  /** Компилирует один DataView source в Endge.program без запуска остальных compiler-фаз. */
  public buildDataView(entity: RDataView): ProgramArtifact<DataViewProgramPayload> {
    const context: ProgramCompileContext = { compilerVersion: ENDGE_COMPILER_VERSION }
    return this.compileEntity('data-view', entity, context) as ProgramArtifact<DataViewProgramPayload>
  }

  public buildFilter(entity: RFilter): ProgramArtifact<FilterProgramPayload> {
    const context: ProgramCompileContext = { compilerVersion: ENDGE_COMPILER_VERSION }
    return this.compileEntity('filter', entity, context) as ProgramArtifact<FilterProgramPayload>
  }

  public buildComposition(entity: RComposition): ProgramArtifact<CompositionProgramPayload> {
    const context: ProgramCompileContext = { compilerVersion: ENDGE_COMPILER_VERSION }
    return this.compileEntity('composition', entity, context) as ProgramArtifact<CompositionProgramPayload>
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
            previewOptions: result.previewOptions,
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
        const localDataViews = artifact
          ? this._materializeQueryLocalDataViews(artifact, entity, context)
          : { payload: undefined, children: [], diagnostics: [], dependencies: [] }
        const local = localDataViews.payload
          ? this._materializeQueryLocalFilters(localDataViews.payload, entity, context, localDataViews)
          : localDataViews

        return this._makeArtifact(entity, 'query', context, {
          capabilities: ['compilable', 'runnable', 'data-provider'],
          payload: {
            ...this._makeEmptyQueryPayload(),
            ...(local.payload ?? artifact ?? {}),
            sourceVersion: Number(entity.sourceVersion ?? 2) || 2,
            ast: result.ast ?? null,
            sourceDocument: result.document ?? null,
          },
          dependencies: local.dependencies,
          diagnostics: [
            ...((result.diagnostics ?? []) as Omit<ProgramDiagnostic, 'entityRef'>[]),
            ...local.diagnostics,
          ],
          children: local.children,
        })
      },
    })

    this.registerHandler<RDataView, DataViewProgramPayload>({
      entityType: 'data-view',
      compile: (entity, context) => {
        const source = this._resolveDataViewSource(entity)
        const result = Endge.source.compile('data-view', source)
        const artifact = result.artifact as DataViewProgramPayload | undefined
        const local = artifact
          ? this._materializeDataViewLocalDataViews(artifact, entity, context)
          : { payload: undefined, children: [], diagnostics: [], dependencies: [] }

        return this._makeArtifact(entity, 'data-view', context, {
          capabilities: ['compilable', 'runnable', 'data-provider'],
          payload: {
            ...this._makeEmptyDataViewPayload(),
            ...(local.payload ?? artifact ?? {}),
            sourceDocument: (result.document as DataViewProgramPayload['sourceDocument']) ?? null,
          },
          dependencies: local.dependencies,
          diagnostics: [
            ...((result.diagnostics ?? []) as Omit<ProgramDiagnostic, 'entityRef'>[]),
            ...local.diagnostics,
          ],
          children: local.children,
        })
      },
    })

    this.registerHandler<RFilter, FilterProgramPayload>({
      entityType: 'filter',
      compile: (entity, context) => {
        const result = Endge.source.compile('filter', this._resolveFilterSource(entity))
        const compiledPayload = result.artifact as FilterProgramPayload | undefined
        const payload = compiledPayload
          ? { ...compiledPayload, sourceVersion: Number(entity.sourceVersion ?? 1) || 1 }
          : undefined
        const dependencies: ProgramArtifact['dependencies'] = []
        for (const field of payload?.fields ?? []) {
          if (field.vocab) {
            dependencies.push({
              entityType: 'vocabs',
              id: field.vocab.identity,
              identity: field.vocab.identity,
              role: 'vocab',
            })
            if (!Endge.domain.getVocab(field.vocab.identity)) {
              ;(result.diagnostics ??= []).push({
                severity: 'error',
                code: 'filter-vocab-missing',
                message: `Vocab "${field.vocab.identity}" не найден.`,
                sourcePath: `fields.${field.key}.vocab`,
              })
            }
          }
        }
        return this._makeArtifact(entity, 'filter', context, {
          capabilities: ['compilable', 'executable', 'data-provider', 'configuration'],
          payload: payload ?? this._makeEmptyFilterPayload(entity.sourceVersion),
          dependencies,
          diagnostics: (result.diagnostics ?? []) as Omit<ProgramDiagnostic, 'entityRef'>[],
        })
      },
    })

    this.registerHandler<RComposition, CompositionProgramPayload>({
      entityType: 'composition',
      compile: (entity, context) => {
        const result = Endge.source.compile('composition', this._resolveCompositionSource(entity))
        const compiledPayload = result.artifact as CompositionProgramPayload | undefined
        const payload = compiledPayload
          ? { ...compiledPayload, sourceVersion: Number(entity.sourceVersion ?? 1) || 1 }
          : undefined
        const validation = payload ? this._validateComposition(payload) : { diagnostics: [], dependencies: [] }
        return this._makeArtifact(entity, 'composition', context, {
          capabilities: ['compilable', 'executable', 'configuration'],
          payload: payload ?? this._makeEmptyCompositionPayload(entity.sourceVersion),
          dependencies: validation.dependencies,
          diagnostics: [
            ...((result.diagnostics ?? []) as Omit<ProgramDiagnostic, 'entityRef'>[]),
            ...validation.diagnostics,
          ],
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
      children?: ProgramArtifact[]
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
      children: options.children?.length ? options.children : undefined,
    }
  }

  /** Материализует локальные DataView внутри query output graph в child artifacts. */
  private _materializeQueryLocalDataViews(
    payload: QueryProgramPayload,
    entity: RQuery,
    context: ProgramCompileContext,
  ): {
      payload: QueryProgramPayload
      children: ProgramArtifact[]
      diagnostics: Omit<ProgramDiagnostic, 'entityRef'>[]
      dependencies: ProgramArtifact['dependencies']
    } {
    const ownerRef = this._makeRef(entity, 'query')
    const children: ProgramArtifact[] = []
    const diagnostics: Omit<ProgramDiagnostic, 'entityRef'>[] = []
    const dependencies: ProgramArtifact['dependencies'] = []

    const strategies = new Map<string, DataViewMaterializationStrategy>()
    const outputs: QueryProgramOutput[] = []
    for (const output of payload.outputs) {
      const dataViews = this._materializeDataViewRefs(
        output.dataViews,
        ownerRef.identity,
        `outputs.${output.key}.dataView`,
        context,
        children,
        diagnostics,
        dependencies,
      )
      let materialization: QueryProgramOutput['materialization']
      if (output.source.type === 'response' && dataViews.length === 0) {
        materialization = { kind: 'source' }
      }
      else {
        const strategy: DataViewMaterializationStrategy = dataViews.length
          ? this._resolveDataViewChainStrategy(dataViews, children)
          : output.source.type === 'output'
            ? strategies.get(output.source.key) ?? { kind: 'full' }
            : { kind: 'full' }
        materialization = { kind: 'derived', strategy }
        strategies.set(output.key, strategy)
      }
      outputs.push({ ...output, dataViews, materialization })
    }

    return {
      payload: { ...payload, outputs },
      children,
      diagnostics,
      dependencies,
    }
  }

  /** Сворачивает цепочку DataView: byKey допустим только при одинаковом доказанном ключе. */
  private _resolveDataViewChainStrategy(
    refs: DataViewRef[],
    localChildren: ProgramArtifact[],
  ): DataViewMaterializationStrategy {
    let key: string | null = null
    for (const ref of refs) {
      let artifact: ProgramArtifact<DataViewProgramPayload> | null = null
      if (ref.kind === 'local')
        artifact = this._findDataViewChild(localChildren, ref.ref.id, ref.ref.identity)
      else if (ref.kind === 'external')
        artifact = Endge.program.getDataViewArtifact(ref.identity)
      if (!artifact || artifact.status === 'error' || artifact.payload.materializationStrategy.kind !== 'collection-by-key')
        return { kind: 'full' }
      const currentKey = artifact.payload.materializationStrategy.key
      if (key != null && key !== currentKey)
        return { kind: 'full' }
      key = currentKey
    }
    return key == null ? { kind: 'full' } : { kind: 'collection-by-key', key }
  }

  private _findDataViewChild(
    children: ProgramArtifact[],
    id: string | number,
    identity: string,
  ): ProgramArtifact<DataViewProgramPayload> | null {
    for (const child of children) {
      if (child.ref.entityType === 'data-view' && (child.ref.id === id || child.ref.identity === identity))
        return child as ProgramArtifact<DataViewProgramPayload>
      const nested = this._findDataViewChild(child.children ?? [], id, identity)
      if (nested)
        return nested
    }
    return null
  }

  /** Материализует локальные Filter defaults query props в child artifacts. */
  private _materializeQueryLocalFilters(
    payload: QueryProgramPayload,
    entity: RQuery,
    context: ProgramCompileContext,
    seed: {
      children: ProgramArtifact[]
      diagnostics: Omit<ProgramDiagnostic, 'entityRef'>[]
      dependencies: ProgramArtifact['dependencies']
    },
  ): {
      payload: QueryProgramPayload
      children: ProgramArtifact[]
      diagnostics: Omit<ProgramDiagnostic, 'entityRef'>[]
      dependencies: ProgramArtifact['dependencies']
    } {
    const children = [...seed.children]
    const diagnostics = [...seed.diagnostics]
    const dependencies = [...seed.dependencies]
    const ownerIdentity = String(entity.identity ?? entity.id)

    const props = payload.props.map((prop) => {
      const source = prop.defaultSource
      if (!source)
        return prop

      if (source.kind === 'filter') {
        if (prop.type !== 'Object') {
          diagnostics.push({
            severity: 'error',
            code: 'query-filter-default-prop-type',
            message: `Filter output default поддерживается только для Object prop; "${prop.key}" имеет тип ${prop.type}.`,
            sourcePath: `props.${prop.key}.from`,
          })
        }
        dependencies.push({
          entityType: 'filter',
          id: source.identity,
          identity: source.identity,
          role: 'query-prop-default',
        })
        const filterArtifact = Endge.program.getFilterArtifact(source.identity)
        if (!filterArtifact) {
          diagnostics.push({
            severity: 'error',
            code: 'query-filter-default-missing',
            message: `Filter "${source.identity}" не найден в compiled program.`,
            sourcePath: `props.${prop.key}.from`,
          })
        }
        else if (filterArtifact.status === 'error') {
          diagnostics.push({
            severity: 'error',
            code: 'query-filter-default-invalid',
            message: `Filter "${source.identity}" содержит compile errors.`,
            sourcePath: `props.${prop.key}.from`,
          })
        }
        else if (!filterArtifact.payload.outputs.some(output => output.key === source.output)) {
          diagnostics.push({
            severity: 'error',
            code: 'query-filter-default-output-missing',
            message: `Filter "${source.identity}" не содержит output "${source.output}".`,
            sourcePath: `props.${prop.key}.from`,
          })
        }
        else if (filterArtifact.payload.outputs.find(output => output.key === source.output)?.kind !== 'json') {
          diagnostics.push({
            severity: 'error',
            code: 'query-filter-default-output-kind',
            message: `Filter output "${source.identity}.${source.output}" должен иметь kind json.`,
            sourcePath: `props.${prop.key}.from`,
          })
        }
        return prop
      }

      if (source.kind === 'local-filter')
        return prop

      const child = this._compileLocalFilterArtifact(
        source.source,
        ownerIdentity,
        `props.${prop.key}.from`,
        context,
      )
      children.push(child)
      if (prop.type !== 'Object') {
        diagnostics.push({
          severity: 'error',
          code: 'query-filter-default-prop-type',
          message: `Локальный Filter output default поддерживается только для Object prop; "${prop.key}" имеет тип ${prop.type}.`,
          sourcePath: `props.${prop.key}.from`,
        })
      }
      diagnostics.push(...child.diagnostics.map(item => ({
        severity: item.severity,
        code: item.code,
        message: item.message,
        sourcePath: `props.${prop.key}.from${item.sourcePath ? `.${item.sourcePath}` : ''}`,
        start: item.start,
        end: item.end,
      })))
      if (!child.payload.outputs.some(output => output.key === source.output)) {
        diagnostics.push({
          severity: 'error',
          code: 'query-local-filter-default-output-missing',
          message: `Локальный Filter не содержит output "${source.output}".`,
          sourcePath: `props.${prop.key}.from`,
        })
      }
      else if (child.payload.outputs.find(output => output.key === source.output)?.kind !== 'json') {
        diagnostics.push({
          severity: 'error',
          code: 'query-local-filter-default-output-kind',
          message: `Локальный Filter output "${source.output}" должен иметь kind json.`,
          sourcePath: `props.${prop.key}.from`,
        })
      }
      return {
        ...prop,
        defaultSource: {
          kind: 'local-filter' as const,
          ref: child.ref as { entityType: 'filter', id: string | number, identity: string },
          output: source.output,
        },
      }
    })

    return { payload: { ...payload, props }, children, diagnostics, dependencies }
  }

  /** Компилирует owned Filter artifact без регистрации в Endge.program. */
  private _compileLocalFilterArtifact(
    source: string,
    ownerIdentity: string,
    sourcePath: string,
    context: ProgramCompileContext,
  ): ProgramArtifact<FilterProgramPayload> {
    const result = Endge.source.compile('filter', source)
    const payload = result.artifact as FilterProgramPayload | undefined
    const diagnostics = [
      ...((result.diagnostics ?? []) as Omit<ProgramDiagnostic, 'entityRef'>[]),
    ]
    for (const field of payload?.fields ?? []) {
      if (field.vocab && !Endge.domain.getVocab(field.vocab.identity)) {
        diagnostics.push({
          severity: 'error',
          code: 'filter-vocab-missing',
          message: `Vocab "${field.vocab.identity}" не найден.`,
          sourcePath: `fields.${field.key}.vocab`,
        })
      }
    }
    const entity = {
      id: `${ownerIdentity}::${sourcePath}::${this._localFilterCounter += 1}`,
      identity: `${ownerIdentity}::${sourcePath}`,
      name: `${ownerIdentity}::${sourcePath}`,
      source,
      sourceVersion: 1,
    }
    return this._makeArtifact(entity, 'filter', context, {
      capabilities: ['compilable', 'executable', 'data-provider', 'configuration'],
      payload: payload ?? this._makeEmptyFilterPayload(1),
      diagnostics,
      dependencies: (payload?.fields ?? [])
        .filter(field => field.vocab)
        .map(field => ({
          entityType: 'vocabs',
          id: field.vocab!.identity,
          identity: field.vocab!.identity,
          role: 'vocab',
        })),
    })
  }

  /** Проверяет domain/program references и stable-prop bindings Composition. */
  private _validateComposition(payload: CompositionProgramPayload): {
    diagnostics: Omit<ProgramDiagnostic, 'entityRef'>[]
    dependencies: ProgramArtifact['dependencies']
  } {
    const diagnostics: Omit<ProgramDiagnostic, 'entityRef'>[] = []
    const dependencies: ProgramArtifact['dependencies'] = []

    for (const runtime of payload.runtimes) {
      const dependencySource = runtime.kind === 'filter-fields'
        ? payload.runtimes.find(item => item.name === runtime.identity)
        : runtime
      dependencies.push({
        entityType: runtime.kind === 'filter-fields' ? 'filter' : runtime.kind,
        id: dependencySource?.identity ?? runtime.identity,
        identity: dependencySource?.identity ?? runtime.identity,
        role: 'composition-runtime',
      })

      if (runtime.kind === 'filter-fields') {
        const source = payload.runtimes.find(item => item.name === runtime.identity)
        if (!source || source.kind !== 'filter') {
          diagnostics.push({ severity: 'error', code: 'composition-filter-fields-source-kind', message: `filterFields source "${runtime.identity}" должен быть Filter runtime.`, sourcePath: `runtimes.${runtime.name}` })
          continue
        }
        const artifact = Endge.program.getFilterArtifact(source.identity)
        if (artifact) {
          const keys = new Set(artifact.payload.fields.map(field => field.key))
          for (const key of runtime.fields ?? []) {
            if (!keys.has(key)) {
              diagnostics.push({ severity: 'error', code: 'composition-filter-fields-field-missing', message: `Filter "${source.identity}" не содержит field "${key}".`, sourcePath: `runtimes.${runtime.name}.fields` })
            }
          }
        }
        continue
      }

      if (runtime.kind === 'filter') {
        const model = Endge.domain.getFilter(runtime.identity)
        const artifact = Endge.program.getFilterArtifact(runtime.identity)
        if (!model)
          diagnostics.push({ severity: 'error', code: 'composition-filter-missing', message: `Filter "${runtime.identity}" не найден.`, sourcePath: `runtimes.${runtime.name}` })
        else if (!artifact)
          diagnostics.push({ severity: 'error', code: 'composition-filter-artifact-missing', message: `Filter "${runtime.identity}" найден в домене, но не собран в compiled program. Проверьте source фильтра или предыдущие ошибки build.`, sourcePath: `runtimes.${runtime.name}` })
        else if (artifact.status === 'error')
          diagnostics.push({ severity: 'error', code: 'composition-filter-invalid', message: `Filter "${runtime.identity}" содержит compile errors.`, sourcePath: `runtimes.${runtime.name}` })
      }
      else if (runtime.kind === 'query') {
        const model = Endge.domain.getQuery(runtime.identity)
        const artifact = Endge.program.getQueryArtifact(runtime.identity)
        if (!model) {
          diagnostics.push({ severity: 'error', code: 'composition-query-missing', message: `Query "${runtime.identity}" не найден.`, sourcePath: `runtimes.${runtime.name}` })
          continue
        }
        if (!artifact) {
          diagnostics.push({ severity: 'error', code: 'composition-query-artifact-missing', message: `Query "${runtime.identity}" найден в домене, но не собран в compiled program. Проверьте source запроса или предыдущие ошибки build.`, sourcePath: `runtimes.${runtime.name}` })
          continue
        }
        if (artifact.status === 'error') {
          diagnostics.push({ severity: 'error', code: 'composition-query-invalid', message: `Query "${runtime.identity}" содержит compile errors.`, sourcePath: `runtimes.${runtime.name}` })
          continue
        }
        const propNames = new Set(artifact.payload.props.map(prop => prop.key))
        for (const propName of Object.keys(runtime.props)) {
          if (artifact.payload.requestBody && !propNames.has(propName)) {
            diagnostics.push({
              severity: 'error',
              code: 'composition-query-prop-missing',
              message: `Query "${runtime.identity}" не объявляет prop "${propName}".`,
              sourcePath: `runtimes.${runtime.name}.withProps.${propName}`,
            })
          }
        }
      }
      else {
        const componentSFC = Endge.domain.getComponentSFC(runtime.identity)
        const component = Endge.domain.getComponent(runtime.identity)
        if (componentSFC && component) {
          diagnostics.push({ severity: 'error', code: 'composition-component-ambiguous', message: `Component identity "${runtime.identity}" неоднозначна.`, sourcePath: `runtimes.${runtime.name}` })
        }
        else if (!componentSFC && !component) {
          diagnostics.push({ severity: 'error', code: 'composition-component-missing', message: `Component "${runtime.identity}" не найден.`, sourcePath: `runtimes.${runtime.name}` })
        }
      }
    }

    for (const output of payload.outputs) {
      if (!output.output)
        continue
      const runtime = payload.runtimes.find(item => item.name === output.runtime)
      const outputExists = runtime?.kind === 'filter'
        ? Endge.program.getFilterArtifact(runtime.identity)?.payload.outputs.some(item => item.key === output.output)
        : runtime?.kind === 'query'
          ? Endge.program.getQueryArtifact(runtime.identity)?.payload.outputs.some(item => item.key === output.output)
          : false
      if (!outputExists) {
        diagnostics.push({
          severity: 'error',
          code: 'composition-output-selection-missing',
          message: `Runtime "${runtime?.identity ?? output.runtime}" не содержит output "${output.output}".`,
          sourcePath: `outputs.${output.key}`,
        })
      }
    }

    for (const target of payload.runtimes) {
      for (const [propName, binding] of Object.entries(target.props)) {
        if (binding.kind !== 'output')
          continue
        const source = payload.runtimes.find(item => item.name === binding.runtime)
        if (!source)
          continue
        const outputExists = source.kind === 'filter'
          ? Endge.program.getFilterArtifact(source.identity)?.payload.outputs.some(item => item.key === binding.output)
          : source.kind === 'query'
            ? Endge.program.getQueryArtifact(source.identity)?.payload.outputs.some(item => item.key === binding.output)
            : false
        if (!outputExists) {
          diagnostics.push({
            severity: 'error',
            code: 'composition-binding-output-missing',
            message: `Runtime "${binding.runtime}" не содержит output "${binding.output}".`,
            sourcePath: `runtimes.${target.name}.withProps.${propName}`,
          })
        }
      }
    }

    for (const hook of payload.hooks) {
      if (hook.kind !== 'change')
        continue
      const source = payload.runtimes.find(item => item.name === hook.runtime)
      const outputExists = source?.kind === 'filter'
        ? Endge.program.getFilterArtifact(source.identity)?.payload.outputs.some(item => item.key === hook.output)
        : source?.kind === 'query'
          ? Endge.program.getQueryArtifact(source.identity)?.payload.outputs.some(item => item.key === hook.output)
          : false
      if (!outputExists) {
        diagnostics.push({
          severity: 'error',
          code: 'composition-hook-output-missing',
          message: `Hook source "${hook.runtime}.${hook.output}" не существует.`,
          sourcePath: `hooks.${hook.runtime}.${hook.output}`,
        })
      }
    }

    return { diagnostics, dependencies }
  }

  /** Материализует локальные DataView внутри DataView pipeline steps в child artifacts. */
  private _materializeDataViewLocalDataViews(
    payload: DataViewProgramPayload,
    entity: RDataView | { id?: string | number, identity?: string, name?: string },
    context: ProgramCompileContext,
  ): {
      payload: DataViewProgramPayload
      children: ProgramArtifact[]
      diagnostics: Omit<ProgramDiagnostic, 'entityRef'>[]
      dependencies: ProgramArtifact['dependencies']
    } {
    const ownerRef = this._makeRef(entity, 'data-view')
    const children: ProgramArtifact[] = []
    const diagnostics: Omit<ProgramDiagnostic, 'entityRef'>[] = []
    const dependencies: ProgramArtifact['dependencies'] = []

    const steps = this._materializeDataViewRefsInSteps(
      payload.steps,
      ownerRef.identity,
      'steps',
      context,
      children,
      diagnostics,
      dependencies,
    )

    return {
      payload: { ...payload, steps },
      children,
      diagnostics,
      dependencies,
    }
  }

  /** Материализует локальные DataView refs внутри pipeline steps. */
  private _materializeDataViewRefsInSteps(
    steps: DataViewPipelineStep[],
    ownerIdentity: string,
    sourcePath: string,
    context: ProgramCompileContext,
    children: ProgramArtifact[],
    diagnostics: Omit<ProgramDiagnostic, 'entityRef'>[],
    dependencies: ProgramArtifact['dependencies'],
  ): DataViewPipelineStep[] {
    return steps.map((step, index) => {
      if (step.type !== 'from' || !step.dataViews?.length)
        return step

      return {
        ...step,
        dataViews: this._materializeDataViewRefs(
          step.dataViews,
          ownerIdentity,
          `${sourcePath}.${index}.dataView`,
          context,
          children,
          diagnostics,
          dependencies,
        ),
      }
    })
  }

  /** Заменяет inline DataView refs на local refs и собирает external dependencies. */
  private _materializeDataViewRefs(
    refs: DataViewRef[],
    ownerIdentity: string,
    sourcePath: string,
    context: ProgramCompileContext,
    children: ProgramArtifact[],
    diagnostics: Omit<ProgramDiagnostic, 'entityRef'>[],
    dependencies: ProgramArtifact['dependencies'],
  ): DataViewRef[] {
    return refs.map((ref, index) => {
      if (ref.kind === 'external') {
        dependencies.push({
          entityType: 'data-view',
          id: ref.identity,
          identity: ref.identity,
          role: 'data-view',
        })
        return ref
      }

      if (ref.kind === 'local')
        return ref

      const child = this._compileLocalDataViewArtifact(
        ref.source,
        ownerIdentity,
        `${sourcePath}.${index}`,
        context,
      )
      children.push(child)
      diagnostics.push(...child.diagnostics.map(diagnostic => ({
        severity: diagnostic.severity,
        code: diagnostic.code,
        message: diagnostic.message,
        sourcePath: `${sourcePath}.${index}${diagnostic.sourcePath ? `.${diagnostic.sourcePath}` : ''}`,
        start: diagnostic.start,
        end: diagnostic.end,
      })))

      return {
        kind: 'local',
        ref: {
          entityType: 'data-view',
          id: child.ref.id,
          identity: child.ref.identity,
        },
      }
    })
  }

  /** Компилирует локальный DataView source в child artifact без записи в Endge.program. */
  private _compileLocalDataViewArtifact(
    source: string,
    ownerIdentity: string,
    sourcePath: string,
    context: ProgramCompileContext,
  ): ProgramArtifact<DataViewProgramPayload> {
    const result = Endge.source.compile('data-view', source)
    const artifact = result.artifact as DataViewProgramPayload | undefined
    const entity = {
      id: `${ownerIdentity}::${sourcePath}::${this._localDataViewCounter += 1}`,
      identity: `${ownerIdentity}::${sourcePath}`,
      name: `${ownerIdentity}::${sourcePath}`,
      source,
      sourceVersion: 1,
    }
    const children: ProgramArtifact[] = []
    const diagnostics: Omit<ProgramDiagnostic, 'entityRef'>[] = [
      ...((result.diagnostics ?? []) as Omit<ProgramDiagnostic, 'entityRef'>[]),
    ]
    const dependencies: ProgramArtifact['dependencies'] = []
    let payload: DataViewProgramPayload = {
      ...this._makeEmptyDataViewPayload(),
      ...(artifact ?? {}),
      sourceDocument: (result.document as DataViewProgramPayload['sourceDocument']) ?? null,
    }

    if (artifact) {
      const local = this._materializeDataViewLocalDataViews(payload, entity, context)
      payload = local.payload
      children.push(...local.children)
      diagnostics.push(...local.diagnostics)
      dependencies.push(...local.dependencies)
    }

    return this._makeArtifact(entity, 'data-view', context, {
      capabilities: ['compilable', 'runnable', 'data-provider'],
      payload,
      diagnostics,
      dependencies,
      children,
    })
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
    if (entity instanceof RQuery || entity instanceof RDataView || entity instanceof RFilter || entity instanceof RComposition) {
      return {
        id: entity?.id ?? null,
        identity: entity?.identity ?? null,
        name: entity?.name ?? null,
        source: entity?.source ?? null,
        sourceVersion: entity?.sourceVersion ?? null,
      }
    }

    return {
      id: entity?.id ?? null,
      identity: entity?.identity ?? null,
      name: entity?.name ?? null,
      type: entity?.type ?? null,
      kind: entity?.kind ?? null,
      source: entity?.source ?? null,
      sourceVersion: entity?.sourceVersion ?? null,
      definition: entity?.definition ?? null,
      updatedAt: entity?.updatedAt ?? null,
    }
  }

  /** Возвращает сохраненный query source. Legacy generation больше не используется runtime compiler-ом. */
  private _resolveQuerySource(entity: RQuery): string {
    const source = typeof entity.source === 'string' ? entity.source.trim() : ''
    if (source)
      return source

    throw new Error(`Query source is required for "${entity.identity ?? entity.name ?? entity.id}".`)
  }

  /** Возвращает сохраненный DataView source. */
  private _resolveDataViewSource(entity: RDataView): string {
    const source = typeof entity.source === 'string' ? entity.source.trim() : ''
    if (source)
      return source

    throw new Error(`DataView source is required for "${entity.identity ?? entity.name ?? entity.id}".`)
  }

  /** Возвращает Filter source без fallback на legacy fields. */
  private _resolveFilterSource(entity: RFilter): string {
    return typeof entity.source === 'string' ? entity.source : ''
  }

  /** Возвращает сохраненный Composition source. */
  private _resolveCompositionSource(entity: RComposition): string {
    return typeof entity.source === 'string' ? entity.source : ''
  }

  /** Создает пустой query payload для error-artifact. */
  private _makeEmptyQueryPayload(): QueryProgramPayload {
    return {
      type: 'query-rest',
      sourceVersion: 2,
      endpoint: '',
      query: '',
      props: [],
      requestBody: null,
      outputs: [],
    }
  }

  /** Создает пустой Filter payload для error-artifact. */
  private _makeEmptyFilterPayload(sourceVersion = 1): FilterProgramPayload {
    return {
      type: 'filter',
      sourceVersion,
      fields: [],
      defaults: {},
      outputs: [],
    }
  }

  /** Создает пустой Composition payload для error-artifact. */
  private _makeEmptyCompositionPayload(sourceVersion = 1): CompositionProgramPayload {
    return {
      type: 'composition',
      sourceVersion,
      runtimes: [],
      hooks: [],
      outputs: [],
    }
  }

  /** Создает пустой DataView payload для error-artifact. */
  private _makeEmptyDataViewPayload(): DataViewProgramPayload {
    return {
      type: 'data-view',
      mode: 'manual',
      materializationStrategy: { kind: 'full' },
      sourceDocument: null,
      transform: null,
      steps: [],
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
