import type { EndgeBootContext } from '@/domain/types/kernel/bootstrap.types'
import type { DiagnosticsSpanHandle } from '@/domain/types/diagnostics'
import type { DataViewMaterializationStrategy, DataViewRef, DataViewPipelineStep } from '@/domain/types/source/data-view-source.types'
import type { FilterProgramPayload } from '@/domain/types/source/filter-source.types'
import type { CompositionProgramPayload } from '@/domain/types/source/composition-source.types'
import type { StoreSourceArtifact } from '@/domain/types/source/store-source.types'
import type {
  ComponentSFCProgramPayload,
  ComputationProgramPayload,
  ComponentSFCTagRegistryEntry,
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
  EndgeStyleProgramPayload,
} from '@/domain/types/program/program.types'
import type { EndgeStyleSheetArtifact } from '@/domain/types/style'

import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import { RComponentSFC } from '@/domain/entities/reflect/RComponentSFC'
import { RComputation } from '@/domain/entities/reflect/RComputation'
import { RDataView } from '@/domain/entities/reflect/RDataView'
import { RQuery } from '@/domain/entities/reflect/RQuery'
import { RFilter } from '@/domain/entities/reflect/RFilter'
import { RComposition } from '@/domain/entities/reflect/RComposition'
import { RStore } from '@/domain/entities/reflect/RStore'
import { RStyle } from '@/domain/entities/reflect/RStyle'
import { compileComponentSFC } from '@/model/services/compiler/component-sfc/component-sfc-compile'
import { isComponentSFCBuiltInTag } from '@/model/services/compiler/component-sfc/component-sfc-template'
import { ENDGE_COMPILER_SPAN_GROUPS, ENDGE_COMPILER_VERSION } from '@/model/config/compiler'
import { Endge } from '@/model/endge/kernel/endge'
import { createEmptyProgramMetadata } from '@/domain/types/program/program-metadata.types'
import type { ProgramMetadata } from '@/domain/types/program/program-metadata.types'
import { compileComputation } from '@/model/services/compiler/computation/computation-compile'
import { parseComponentSFC } from '@/model/services/compiler/component-sfc/component-sfc-parse'
import { analyzeComponentSFCScript } from '@/model/services/compiler/component-sfc/component-sfc-script'
import { compileEndgeCSS } from '@/model/services/style'
import { resolveCompositionActivation } from '@/model/services/source-engine/composition-activation'

type ComputationArtifact = ProgramArtifact<ComputationProgramPayload>

const COMPUTATION_LINK_DIAGNOSTICS = new Set([
  'computation-reference-missing',
  'computation-reference-invalid',
  'computation-reference-cycle',
])

/**
 * Компилятор persisted domain model в compiled program artifacts.
 */
export class EndgeCompiler extends EndgeModule {
  private readonly handlers = new Map<ProgramEntityType, EntityCompilerHandler<any, any>>()
  private _localDataViewCounter = 0
  private _localFilterCounter = 0
  private _componentTagDiagnosticsByIdentity = new Map<string, Omit<ProgramDiagnostic, 'entityRef'>[]>()
  private _compileSpan: DiagnosticsSpanHandle | null = null

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
    const context = this._createCompileContext()
    const componentSFCs = Endge.domain.getComponentSFCs()

    Endge.program.beginCompile(ENDGE_COMPILER_VERSION)
    this._prepareComponentTagRegistry(componentSFCs)
    this._compileSpan = Endge.diagnostics.startSpan('domain.compile', {
      scope: { name: 'endge.compiler', version: ENDGE_COMPILER_VERSION },
    })

    try {
      if (!this.compilePhase('computation', ENDGE_COMPILER_SPAN_GROUPS.COMPONENTS, 'computations', Endge.domain.getComputations(), context))
        return
      this._linkComputations()

      if (!this.compilePhase('component-sfc', ENDGE_COMPILER_SPAN_GROUPS.COMPONENTS, 'SFC-компонентов', componentSFCs, context))
        return

      if (!this.compilePhase('style', ENDGE_COMPILER_SPAN_GROUPS.COMPONENTS, 'EndgeCSS styles', this._orderedStyles(), context))
        return

      if (!this.compilePhase('data-view', ENDGE_COMPILER_SPAN_GROUPS.QUERIES, 'data views', Endge.domain.getDataViews(), context))
        return

      if (!this.compilePhase('store', ENDGE_COMPILER_SPAN_GROUPS.QUERIES, 'stores', Endge.domain.getStores(), context))
        return

      if (!this.compilePhase('filter', ENDGE_COMPILER_SPAN_GROUPS.QUERIES, 'filter source', Endge.domain.getFilters(), context))
        return

      if (!this.compilePhase('query', ENDGE_COMPILER_SPAN_GROUPS.QUERIES, 'query source', Endge.domain.getQueries(), context))
        return

      if (!this.compilePhase(
        'composition',
        ENDGE_COMPILER_SPAN_GROUPS.COMPONENTS,
        'compositions',
        this._orderCompositionsForCompile(Endge.domain.getCompositions()),
        context,
      ))
        return

      const diagnostics = Endge.program.getDiagnostics()
      const errorCount = diagnostics.filter(diagnostic => diagnostic.severity === 'error').length
      const warningCount = diagnostics.filter(diagnostic => diagnostic.severity === 'warning').length
      const compileSpan = this._compileSpan
      compileSpan?.log({
        body: errorCount > 0 ? 'Компиляция проекта завершена с ошибками' : 'Компиляция проекта завершена',
        severityNumber: errorCount > 0 ? 17 : warningCount > 0 ? 13 : 9,
        eventName: 'endge.program.compiled',
        attributes: {
          'endge.diagnostics.error.count': errorCount,
          'endge.diagnostics.warning.count': warningCount,
        },
      })
      compileSpan?.end({ status: errorCount > 0 ? 'error' : 'ok' })
      this._compileSpan = null
    }
    catch (error: unknown) {
      this._compileSpan?.recordException(error, { eventName: 'endge.compiler.exception' })
      this._compileSpan?.end({ status: 'error', message: 'Необработанная ошибка compiler pipeline' })
      this._compileSpan = null
      Endge.program.setStatus('error')
    }
  }

  /** Компилирует один query source в Endge.program без запуска остальных compiler-фаз. */
  public buildQuery(entity: RQuery): ProgramArtifact<QueryProgramPayload> {
    const context = this._createCompileContext()
    return this.compileEntity('query', entity, context) as ProgramArtifact<QueryProgramPayload>
  }

  /** Компилирует одну Computation в безопасный runtime artifact. */
  public buildComputation(entity: RComputation): ProgramArtifact<ComputationProgramPayload> {
    const context = this._createCompileContext()
    const artifact = this.compileEntity('computation', entity, context) as ProgramArtifact<ComputationProgramPayload>
    this._linkComputations()
    return artifact
  }

  /** Компилирует один ComponentSFC без запуска полного domain build. */
  public buildComponentSFC(entity: RComponentSFC): ProgramArtifact<ComponentSFCProgramPayload> {
    const context = this._createCompileContext()
    this._prepareComponentTagRegistry(Endge.domain.getComponentSFCs())
    return this.compileEntity('component-sfc', entity, context) as ProgramArtifact<ComponentSFCProgramPayload>
  }

  /** Компилирует один DataView source в Endge.program без запуска остальных compiler-фаз. */
  public buildDataView(entity: RDataView): ProgramArtifact<DataViewProgramPayload> {
    const context = this._createCompileContext()
    return this.compileEntity('data-view', entity, context) as ProgramArtifact<DataViewProgramPayload>
  }

  /** Компилирует один Store source в Endge.program. */
  public buildStore(entity: RStore): ProgramArtifact<StoreSourceArtifact> {
    const context = this._createCompileContext()
    return this.compileEntity('store', entity, context) as ProgramArtifact<StoreSourceArtifact>
  }

  /** Компилирует один Filter source в Endge.program. */
  public buildFilter(entity: RFilter): ProgramArtifact<FilterProgramPayload> {
    const context = this._createCompileContext()
    return this.compileEntity('filter', entity, context) as ProgramArtifact<FilterProgramPayload>
  }

  /** Компилирует один Composition source в Endge.program. */
  public buildComposition(entity: RComposition): ProgramArtifact<CompositionProgramPayload> {
    const context = this._createCompileContext()
    return this.compileEntity('composition', entity, context) as ProgramArtifact<CompositionProgramPayload>
  }

  /** Compiles one global source-first EndgeCSS document. */
  public buildStyle(entity: RStyle): ProgramArtifact<EndgeStyleProgramPayload> {
    const context = this._createCompileContext()
    return this.compileEntity('style', entity, context) as ProgramArtifact<EndgeStyleProgramPayload>
  }

  /**
   * Регистрирует handler компиляции для поддерживаемого program entity.
   *
   * Сейчас используется только для встроенной SFC-регистрации.
   */
  private registerHandler<TEntity, TPayload>(handler: EntityCompilerHandler<TEntity, TPayload>): void {
    this.handlers.set(handler.entityType, handler as EntityCompilerHandler<any, any>)
  }

  /** Создаёт единый immutable context для полного и точечного compiler entry points. */
  private _createCompileContext(): ProgramCompileContext {
    return {
      compilerVersion: ENDGE_COMPILER_VERSION,
      buildContext: Endge.configuration.buildContext,
    }
  }

  /**
   * Компилирует однотипную фазу доменных сущностей через зарегистрированный handler.
   *
   * Метод отвечает за единый diagnostics span, обработку ошибок и перевод
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
    const span = this._compileSpan?.startChild(`compile.${entityType}`, {
      attributes: {
        'endge.compiler.group': lane,
        'endge.compiler.entity.type': entityType,
        'endge.compiler.entity.count': entities.length,
      },
    }) ?? Endge.diagnostics.startSpan(`compile.${entityType}`, {
      scope: { name: 'endge.compiler', version: ENDGE_COMPILER_VERSION },
    })
    span.log({
      body: `Начата компиляция ${title}`,
      severityNumber: 9,
      eventName: 'endge.compiler.phase.started',
    })

    try {
      for (const entity of entities)
        this.compileEntity(entityType, entity, context)

      span.log({
        body: `Компиляция ${title} завершена`,
        severityNumber: 9,
        eventName: 'endge.compiler.phase.completed',
      })
      span.end({ status: 'ok' })
      return true
    }
    catch (error: unknown) {
      span.recordException(error, { eventName: 'endge.compiler.phase.exception' })
      span.end({ status: 'error', message: `Ошибка компиляции ${title}` })
      if (failTraceOnError) {
        this._compileSpan?.end({ status: 'error', message: `Неуспешная compiler phase: ${entityType}` })
        this._compileSpan = null
      }
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
    this.registerHandler<RComputation, ComputationProgramPayload>({
      entityType: 'computation',
      compile: (entity, context) => {
        const result = compileComputation({
          source: entity.source,
          input: fieldContract(entity.input),
          output: fieldContract(entity.output),
        })
        return this._makeArtifact(entity, 'computation', context, {
          capabilities: ['compilable', 'runnable'],
          payload: result.payload,
          diagnostics: result.diagnostics,
          dependencies: this._computationDependencies(result.payload),
        })
      },
    })

    this.registerHandler<RComponentSFC, ComponentSFCProgramPayload>({
      entityType: 'component-sfc',
      compile: (entity, context) => {
        const result = compileComponentSFC(entity.source, {
          identity: entity.identity,
          resolveComponentTag: tag => Endge.program.resolveComponentTag(tag),
          hasComponentIdentity: identity => Endge.domain.getComponentSFC(identity) != null,
          resolvePortProvider: (identity, expectedKind) => this._resolvePortProvider(identity, expectedKind),
        })
        return this._makeArtifact(entity, 'component-sfc', context, {
          capabilities: result.ir ? ['compilable', 'runnable', 'renderable'] : ['compilable'],
          metadata: result.metadata,
          payload: {
            sourceParts: result.sourceParts,
            sections: result.sections,
            contract: result.contract,
            dependencies: result.dependencies,
            runtimeDependencies: result.runtimeDependencies,
            previewProps: result.previewProps,
            previewOptions: result.previewOptions,
            ast: result.ast,
            ir: result.ir,
          },
          diagnostics: [
            ...(this._componentTagDiagnosticsByIdentity.get(entity.identity) ?? []),
            ...result.diagnostics,
          ],
          dependencies: [
            ...result.dependencies.components.map(dependency => ({
              entityType: 'component-sfc',
              id: dependency.id,
              identity: String(dependency.id),
              role: dependency.role ?? 'child-component',
            })),
            ...result.dependencies.computations.map(dependency => ({
              entityType: 'computation',
              id: dependency.id,
              identity: String(dependency.id),
              role: dependency.role,
            })),
          ],
          nonBlockingSourcePaths: ['style'],
        })
      },
    })

    this.registerHandler<RStyle, EndgeStyleProgramPayload>({
      entityType: 'style',
      compile: (entity, context) => {
        const result = compileEndgeCSS(entity.source, { identity: entity.identity, scope: 'global' })
        const stylesheet: EndgeStyleSheetArtifact = result.artifact ?? {
          language: 'endgecss',
          version: 1,
          identity: entity.identity,
          sourceHash: this._hashString(entity.source),
          scope: 'global',
          rules: [],
          themes: [],
          indexes: { universal: [], tags: {}, classes: {}, ids: {}, components: {}, identities: {}, states: {}, parts: {} },
        }
        return this._makeArtifact(entity, 'style', context, {
          capabilities: ['compilable', 'configuration'],
          payload: {
            stylesheet,
            themes: stylesheet.themes.map(theme => theme.id),
            dependencies: [],
          },
          diagnostics: result.diagnostics.map(diagnostic => ({
            severity: diagnostic.severity,
            code: diagnostic.code,
            message: diagnostic.message,
            sourcePath: 'source',
            start: diagnostic.range?.start,
            end: diagnostic.range?.end,
          })),
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
          metadata: { self: result.metadata ?? {}, nodes: [] },
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
          metadata: { self: result.metadata ?? {}, nodes: [] },
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

    this.registerHandler<RStore, StoreSourceArtifact>({
      entityType: 'store',
      compile: (entity, context) => {
        const result = Endge.source.compile('store', entity.source)
        const payload = result.artifact as StoreSourceArtifact | undefined
        const dependencies: ProgramArtifact['dependencies'] = []
        for (const field of payload?.data ?? []) {
          if (field.kind === 'value' && field.initial.kind === 'mock') {
            dependencies.push({
              entityType: 'mock-data',
              id: field.initial.identity,
              identity: field.initial.identity,
              role: `store-initial:${field.key}`,
            })
            const mockStatus = Endge.mock.getBindingStatus(field.initial.identity)
            if (mockStatus !== 'document' && mockStatus !== 'connected') {
              const code = mockStatus === 'missing-document'
                ? 'store-mock-document-missing'
                : mockStatus === 'missing-provider'
                  ? 'store-mock-provider-missing'
                  : 'store-mock-invalid-content'
              ;(result.diagnostics ??= []).push({
                severity: 'error',
                code,
                message: `Mock "${field.initial.identity}" для Store field "${field.key}" недоступен: ${mockStatus}.`,
                sourcePath: `data.${field.key}`,
              })
            }
          }
          if (field.kind !== 'derived')
            continue
          for (const ref of field.dataViews) {
            if (ref.kind !== 'external')
              continue
            dependencies.push({
              entityType: 'data-view',
              id: ref.identity,
              identity: ref.identity,
              role: `store-derived:${field.key}`,
            })
            const dataViewArtifact = Endge.program.getDataViewArtifact(ref.identity)
            if (!dataViewArtifact || dataViewArtifact.status === 'error') {
              ;(result.diagnostics ??= []).push({
                severity: 'error',
                code: 'store-data-view-invalid',
                message: `DataView "${ref.identity}" для Store field "${field.key}" отсутствует или содержит compile errors.`,
                sourcePath: `data.${field.key}`,
              })
            }
          }
        }
        return this._makeArtifact(entity, 'store', context, {
          capabilities: ['compilable', 'executable', 'data-provider'],
          metadata: createEmptyProgramMetadata(),
          payload: payload ?? { type: 'store', sourceVersion: Number(entity.sourceVersion ?? 1) || 1, data: [] },
          dependencies,
          diagnostics: (result.diagnostics ?? []) as Omit<ProgramDiagnostic, 'entityRef'>[],
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
          metadata: { self: result.metadata ?? {}, nodes: [] },
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
        const validation = payload ? this._validateComposition(payload, entity) : { diagnostics: [], dependencies: [] }
        return this._makeArtifact(entity, 'composition', context, {
          capabilities: ['compilable', 'executable', 'configuration'],
          metadata: { self: result.metadata ?? {}, nodes: [] },
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

  /** Stable source order: system documents first, then authored documents by identity. */
  private _orderedStyles(): RStyle[] {
    const rank = (style: RStyle) => style.isSystem ? 0 : 1
    return Endge.domain.getStyles()
      .filter(style => style.active !== false && !style.deletedAt)
      .sort((left, right) => rank(left) - rank(right) || left.identity.localeCompare(right.identity))
  }

  /** Возвращает static artifact dependencies внешних computation calls. */
  private _computationDependencies(payload: ComputationProgramPayload): ProgramArtifact['dependencies'] {
    const identities = new Set<string>()
    const dependencies: ProgramArtifact['dependencies'] = []
    for (const node of payload.nodes) {
      if (node.kind !== 'computation' || identities.has(node.identity))
        continue
      identities.add(node.identity)
      const target = Endge.domain.getComputation(node.identity)
      dependencies.push({
        entityType: 'computation',
        id: target?.id ?? node.identity,
        identity: node.identity,
        role: 'computation-call',
      })
    }
    return dependencies
  }

  /** Связывает computation artifacts, запрещает missing/invalid/cyclic references и выводит effective execution mode. */
  private _linkComputations(): void {
    const artifacts = Endge.program.getArtifacts()
      .filter((artifact): artifact is ComputationArtifact => artifact.ref.entityType === 'computation')
    const byIdentity = new Map(artifacts.map(artifact => [artifact.ref.identity, artifact]))

    for (const artifact of artifacts) {
      artifact.diagnostics = artifact.diagnostics.filter(item => !COMPUTATION_LINK_DIAGNOSTICS.has(item.code))
      artifact.status = statusFromDiagnostics(artifact.diagnostics)
      artifact.dependencies = this._computationDependencies(artifact.payload)
      artifact.payload.execution = artifact.payload.nodes.some(node => node.kind === 'typescript') ? 'async' : 'sync'
    }

    for (const artifact of artifacts) {
      for (const node of artifact.payload.nodes) {
        if (node.kind !== 'computation' || byIdentity.has(node.identity))
          continue
        this._addComputationLinkDiagnostic(artifact, {
          severity: 'error',
          code: 'computation-reference-missing',
          message: `Computation "${artifact.ref.identity}" ссылается на отсутствующий computation "${node.identity}".`,
          sourcePath: `outputs.${node.name}`,
        })
      }
    }

    const graph = new Map(artifacts.map(artifact => [
      artifact.ref.identity,
      uniqueComputationReferences(artifact.payload).filter(identity => byIdentity.has(identity)),
    ]))
    for (const component of this._findComputationCycles(graph)) {
      const cycle = this._findCyclePath(component, graph)
      const message = `Обнаружен cycle между computations: ${cycle.join(' -> ')}.`
      for (const identity of component) {
        const artifact = byIdentity.get(identity)!
        this._addComputationLinkDiagnostic(artifact, {
          severity: 'error',
          code: 'computation-reference-cycle',
          message,
          sourcePath: 'source',
        })
      }
    }

    let changed = true
    while (changed) {
      changed = false
      for (const artifact of artifacts) {
        for (const identity of uniqueComputationReferences(artifact.payload)) {
          const target = byIdentity.get(identity)
          if (!target || target.status !== 'error' || artifact.status === 'error')
            continue
          this._addComputationLinkDiagnostic(artifact, {
            severity: 'error',
            code: 'computation-reference-invalid',
            message: `Computation "${artifact.ref.identity}" зависит от invalid computation "${identity}".`,
            sourcePath: 'source',
          })
          changed = true
        }
      }
    }

    changed = true
    while (changed) {
      changed = false
      for (const artifact of artifacts) {
        if (artifact.payload.execution === 'async')
          continue
        const hasAsyncDependency = uniqueComputationReferences(artifact.payload)
          .some(identity => byIdentity.get(identity)?.payload.execution === 'async')
        if (hasAsyncDependency) {
          artifact.payload.execution = 'async'
          changed = true
        }
      }
    }

    Endge.program.recalculateStatus()
  }

  /** Добавляет linker diagnostic без duplicate сообщений и обновляет artifact status. */
  private _addComputationLinkDiagnostic(
    artifact: ComputationArtifact,
    value: Omit<ProgramDiagnostic, 'entityRef'>,
  ): void {
    if (artifact.diagnostics.some(item => item.code === value.code && item.message === value.message))
      return
    artifact.diagnostics.push({ ...value, entityRef: artifact.ref })
    artifact.status = statusFromDiagnostics(artifact.diagnostics)
  }

  /** Находит strongly connected components, которые образуют реальные cycles. */
  private _findComputationCycles(graph: Map<string, string[]>): string[][] {
    let index = 0
    const indexes = new Map<string, number>()
    const lowLinks = new Map<string, number>()
    const stack: string[] = []
    const onStack = new Set<string>()
    const cycles: string[][] = []

    const visit = (identity: string) => {
      indexes.set(identity, index)
      lowLinks.set(identity, index++)
      stack.push(identity)
      onStack.add(identity)

      for (const dependency of graph.get(identity) ?? []) {
        if (!indexes.has(dependency)) {
          visit(dependency)
          lowLinks.set(identity, Math.min(lowLinks.get(identity)!, lowLinks.get(dependency)!))
        }
        else if (onStack.has(dependency)) {
          lowLinks.set(identity, Math.min(lowLinks.get(identity)!, indexes.get(dependency)!))
        }
      }

      if (lowLinks.get(identity) !== indexes.get(identity))
        return
      const component: string[] = []
      let member = ''
      do {
        member = stack.pop()!
        onStack.delete(member)
        component.push(member)
      } while (member !== identity)
      if (component.length > 1 || (graph.get(identity) ?? []).includes(identity))
        cycles.push(component)
    }

    for (const identity of graph.keys()) {
      if (!indexes.has(identity))
        visit(identity)
    }
    return cycles
  }

  /** Восстанавливает один точный cycle path внутри strongly connected component. */
  private _findCyclePath(component: string[], graph: Map<string, string[]>): string[] {
    const members = new Set(component)
    const search = (current: string, path: string[]): string[] | null => {
      for (const next of graph.get(current) ?? []) {
        if (!members.has(next))
          continue
        const cycleStart = path.indexOf(next)
        if (cycleStart >= 0)
          return [...path.slice(cycleStart), next]
        const found = search(next, [...path, next])
        if (found)
          return found
      }
      return null
    }
    return search(component[0]!, [component[0]!]) ?? [...component, component[0]!]
  }

  /** Resolves a domain provider descriptor without requiring compile order among SFCs. */
  private _resolvePortProvider(
    identity: string,
    expectedKind: 'computation' | 'component',
  ) {
    const computation = Endge.domain.getComputation(identity)
    const component = Endge.domain.getComponentSFC(identity)
    const target = expectedKind === 'computation'
      ? computation ?? component
      : component ?? computation

    if (target instanceof RComputation) {
      return {
        kind: 'computation' as const,
        identity: target.identity,
        active: target.active !== false && !target.deletedAt,
        input: fieldContract(target.input),
        output: fieldContract(target.output),
      }
    }
    if (target instanceof RComponentSFC) {
      const parsed = parseComponentSFC(target.source)
      const contract = analyzeComponentSFCScript(parsed.ast?.script ?? null).contract
      return {
        kind: 'component' as const,
        identity: target.identity,
        active: target.active !== false && !target.deletedAt,
        inputs: contract.inputs,
      }
    }
    return null
  }

  /**
   * Строит registry пользовательских SFC tags до компиляции templates.
   *
   * В registry попадают только однозначные tags. Конфликты остаются persisted,
   * но превращают artifacts всех владельцев tag в error на build-фазе.
   */
  private _prepareComponentTagRegistry(components: RComponentSFC[]): void {
    this._componentTagDiagnosticsByIdentity.clear()
    const componentsByTag = new Map<string, RComponentSFC[]>()

    for (const component of components) {
      const tag = typeof component.tag === 'string' ? component.tag.trim() : ''
      if (!tag) continue
      const owners = componentsByTag.get(tag) ?? []
      owners.push(component)
      componentsByTag.set(tag, owners)
    }

    const entries: ComponentSFCTagRegistryEntry[] = []
    for (const [tag, owners] of componentsByTag) {
      if (isComponentSFCBuiltInTag(tag)) {
        for (const owner of owners) {
          this._addComponentTagDiagnostic(owner.identity, {
            severity: 'error',
            code: 'component-sfc-tag-reserved',
            message: `SFC tag "${tag}" совпадает со встроенным primitive и не может быть зарегистрирован.`,
            sourcePath: 'tag',
          })
        }
        continue
      }

      if (owners.length > 1) {
        const identities = owners.map(owner => owner.identity).join(', ')
        for (const owner of owners) {
          this._addComponentTagDiagnostic(owner.identity, {
            severity: 'error',
            code: 'component-sfc-tag-duplicate',
            message: `SFC tag "${tag}" повторяется у компонентов: ${identities}.`,
            sourcePath: 'tag',
          })
        }
        continue
      }

      entries.push({ tag, identity: owners[0].identity })
    }

    Endge.program.setComponentTags(entries)
  }

  /** Добавляет build diagnostic владельцу persisted SFC tag. */
  private _addComponentTagDiagnostic(
    identity: string,
    diagnostic: Omit<ProgramDiagnostic, 'entityRef'>,
  ): void {
    const diagnostics = this._componentTagDiagnosticsByIdentity.get(identity) ?? []
    diagnostics.push(diagnostic)
    this._componentTagDiagnosticsByIdentity.set(identity, diagnostics)
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
      metadata?: ProgramMetadata
      dependencies?: ProgramArtifact<TPayload>['dependencies']
      diagnostics?: Omit<ProgramDiagnostic, 'entityRef'>[]
      children?: ProgramArtifact[]
      nonBlockingSourcePaths?: string[]
    },
  ): ProgramArtifact<TPayload> {
    const ref = this._makeRef(entity, entityType)
    const diagnostics = [
      ...this._collectValidationDiagnostics(entity),
      ...(options.diagnostics ?? []),
    ].map(diagnostic => ({ ...diagnostic, entityRef: ref }))
    const blockingDiagnostics = diagnostics.filter(diagnostic => !options.nonBlockingSourcePaths?.includes(diagnostic.sourcePath ?? ''))
    const status = blockingDiagnostics.some(diagnostic => diagnostic.severity === 'error')
      ? 'error'
      : (diagnostics.length ? 'warning' : 'valid')

    return {
      ref,
      sourceHash: this._hashString(JSON.stringify(this._toStableSource(entity))),
      compilerVersion: context.compilerVersion,
      contextHash: context.buildContext.contextHash,
      status,
      diagnostics,
      dependencies: options.dependencies ?? [],
      capabilities: options.capabilities,
      metadata: options.metadata ?? createEmptyProgramMetadata(),
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

  /** Рекурсивно ищет локальный DataView artifact среди дочерних artifacts. */
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
      metadata: { self: result.metadata ?? {}, nodes: [] },
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
  private _validateComposition(payload: CompositionProgramPayload, owner: RComposition): {
    diagnostics: Omit<ProgramDiagnostic, 'entityRef'>[]
    dependencies: ProgramArtifact['dependencies']
  } {
    const diagnostics: Omit<ProgramDiagnostic, 'entityRef'>[] = []
    const dependencies: ProgramArtifact['dependencies'] = []
    const storeArtifacts = new Map<string, StoreSourceArtifact>()

    if (owner.kind === 'project' && !payload.activation) {
      diagnostics.push({
        severity: 'error',
        code: 'composition-project-activation-required',
        message: 'Project Composition должна явно объявлять activateOn: startup() или manual().',
        sourcePath: 'activateOn',
      })
    }

    for (const resource of payload.resources) {
      const style = Endge.domain.getStyle(resource.identity)
      const artifact = Endge.program.getStyleArtifact(resource.identity)
      if (!style) {
        diagnostics.push({ severity: 'error', code: 'composition-style-missing', message: `Style "${resource.identity}" не найден.`, sourcePath: `resources.${resource.path}` })
        continue
      }
      if (!artifact || artifact.status === 'error') {
        diagnostics.push({ severity: 'error', code: 'composition-style-invalid', message: `Style "${resource.identity}" не собран или содержит compile errors.`, sourcePath: `resources.${resource.path}` })
        continue
      }
      dependencies.push({ entityType: 'style', id: style.id, identity: style.identity, role: 'composition-resource' })
    }

    for (const data of payload.data) {
      if (data.kind === 'store') {
        const store = Endge.domain.getStore(data.identity)
        if (!store) {
          diagnostics.push({ severity: 'error', code: 'composition-store-missing', message: `Store "${data.identity}" не найден.`, sourcePath: `data.${data.name}` })
          continue
        }
        const compiled = Endge.program.getStoreArtifact(store.id ?? store.identity)
        if (!compiled || compiled.status === 'error')
          diagnostics.push({ severity: 'error', code: 'composition-store-invalid', message: `Store "${data.identity}" содержит compile errors.`, sourcePath: `data.${data.name}` })
        else
          storeArtifacts.set(data.name, compiled.payload)
        dependencies.push({ entityType: 'store', id: store.id, identity: store.identity, role: 'composition-data' })
      }
      else {
        const vocab = Endge.domain.getVocab(data.identity)
        if (!vocab)
          diagnostics.push({ severity: 'error', code: 'composition-vocab-missing', message: `Vocab "${data.identity}" не найден.`, sourcePath: `data.${data.name}` })
        else
          dependencies.push({ entityType: 'vocabs', id: vocab.id, identity: vocab.identity, role: 'composition-data' })
      }
    }

    /** Проверяет публикацию публичных runtime outputs в writable Store fields. */
    const validateStoreTo = (
      runtime: CompositionProgramPayload['runtimes'][number],
      outputNames: Set<string>,
      runtimeTitle: string,
    ): void => {
      for (const publication of runtime.storeTo) {
        const storeArtifact = storeArtifacts.get(publication.data)
        const writableFields = new Set(
          storeArtifact?.data.filter(field => field.kind === 'value').map(field => field.key) ?? [],
        )
        for (const target of Object.keys(publication.fields)) {
          const root = target.split('.')[0] ?? ''
          if (storeArtifact && !writableFields.has(root)) {
            diagnostics.push({
              severity: 'error',
              code: 'composition-store-to-target-readonly',
              message: `Store target "${publication.data}.${target}" отсутствует или является derived.`,
              sourcePath: `runtimes.${runtime.name}.storeTo`,
            })
          }
        }
        for (const output of Object.values(publication.fields)) {
          if (!outputNames.has(output)) {
            diagnostics.push({
              severity: 'error',
              code: 'composition-store-to-output-missing',
              message: `${runtimeTitle} "${runtime.identity}" не содержит output "${output}".`,
              sourcePath: `runtimes.${runtime.name}.storeTo`,
            })
          }
        }
      }
    }

    for (const runtime of payload.runtimes) {
      const dependencySource = runtime.kind === 'filter-view'
        ? payload.runtimes.find(item => item.name === runtime.identity)
        : runtime
      dependencies.push({
        entityType: runtime.kind === 'filter-view'
          ? 'filter'
          : runtime.kind === 'component'
            ? 'component-sfc'
            : runtime.kind,
        id: dependencySource?.identity ?? runtime.identity,
        identity: dependencySource?.identity ?? runtime.identity,
        role: 'composition-runtime',
      })

      if (runtime.kind === 'filter-view') {
        const source = payload.runtimes.find(item => item.name === runtime.identity)
        if (!source || source.kind !== 'filter') {
          diagnostics.push({ severity: 'error', code: 'composition-filter-view-source-kind', message: `filterView source "${runtime.identity}" должен быть Filter runtime.`, sourcePath: `runtimes.${runtime.name}` })
          continue
        }
        const artifact = Endge.program.getFilterArtifact(source.identity)
        if (artifact) {
          const keys = new Set(artifact.payload.fields.map(field => field.key))
          for (const key of runtime.fields ?? []) {
            if (!keys.has(key)) {
              diagnostics.push({ severity: 'error', code: 'composition-filter-view-field-missing', message: `Filter "${source.identity}" не содержит field "${key}".`, sourcePath: `runtimes.${runtime.name}.fields` })
            }
          }
          for (const key of Object.keys(runtime.controls ?? {})) {
            if (!keys.has(key)) {
              diagnostics.push({ severity: 'error', code: 'composition-filter-view-control-field-missing', message: `Filter "${source.identity}" не содержит field "${key}" из controls.`, sourcePath: `runtimes.${runtime.name}.controls.${key}` })
            }
          }
        }
        if (runtime.componentIdentity) {
          const componentSFC = Endge.domain.getComponentSFC(runtime.componentIdentity)
          if (!componentSFC) {
            diagnostics.push({ severity: 'error', code: 'composition-filter-view-component-missing', message: `Executable SFC component "${runtime.componentIdentity}" не найден.`, sourcePath: `runtimes.${runtime.name}.component` })
          }
          else {
            dependencies.push({
              entityType: 'component-sfc',
              id: componentSFC.id,
              identity: componentSFC.identity,
              role: 'filter-view-component',
            })
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
        const outputNames = new Set(artifact.payload.outputs.map(output => output.key))
        validateStoreTo(runtime, outputNames, 'Query')
      }
      else if (runtime.kind === 'composition') {
        const model = Endge.domain.getComposition(runtime.identity)
        const artifact = Endge.program.getCompositionArtifact(runtime.identity)
        if (runtime.identity === owner.identity) {
          diagnostics.push({ severity: 'error', code: 'composition-self-reference', message: `Composition "${owner.identity}" не может запускать саму себя.`, sourcePath: `runtimes.${runtime.name}` })
          continue
        }
        if (this._compositionDependsOn(runtime.identity, owner.identity)) {
          diagnostics.push({ severity: 'error', code: 'composition-reference-cycle', message: `Composition dependency cycle: "${owner.identity}" → "${runtime.identity}" → "${owner.identity}".`, sourcePath: `runtimes.${runtime.name}` })
          continue
        }
        if (!model) {
          diagnostics.push({ severity: 'error', code: 'composition-composition-missing', message: `Composition "${runtime.identity}" не найдена.`, sourcePath: `runtimes.${runtime.name}` })
          continue
        }
        if (!artifact) {
          diagnostics.push({ severity: 'error', code: 'composition-composition-artifact-missing', message: `Composition "${runtime.identity}" найдена в домене, но не собрана в compiled program. Проверьте source композиции или предыдущие ошибки build.`, sourcePath: `runtimes.${runtime.name}` })
          continue
        }
        if (artifact.status === 'error') {
          diagnostics.push({ severity: 'error', code: 'composition-composition-invalid', message: `Composition "${runtime.identity}" содержит compile errors.`, sourcePath: `runtimes.${runtime.name}` })
          continue
        }
        runtime.effectiveActivation = resolveCompositionActivation(
          runtime.activationOverride,
          artifact.payload.activation,
          payload.scopes.find(scope => scope.path === runtime.scopePath)?.effectiveActivation,
        )
        for (const [targetDataName, sourceDataName] of Object.entries(runtime.dataBindings ?? {})) {
          const sourceData = payload.data.find(item => item.name === sourceDataName)
          const targetData = artifact.payload.data.find(item => item.name === targetDataName)
          if (!targetData) {
            diagnostics.push({
              severity: 'error',
              code: 'composition-with-data-target-missing',
              message: `Composition "${runtime.identity}" не объявляет data alias "${targetDataName}".`,
              sourcePath: `runtimes.${runtime.name}.withData.${targetDataName}`,
            })
            continue
          }
          if (!sourceData || sourceData.kind !== 'store' || targetData.kind !== 'store') {
            diagnostics.push({
              severity: 'error',
              code: 'composition-with-data-kind',
              message: `withData binding "${sourceDataName}" → "${targetDataName}" должен связывать два Store data alias.`,
              sourcePath: `runtimes.${runtime.name}.withData.${targetDataName}`,
            })
            continue
          }
          if (sourceData.identity !== targetData.identity) {
            diagnostics.push({
              severity: 'error',
              code: 'composition-with-data-identity',
              message: `Store identity "${sourceData.identity}" несовместима с ожидаемой "${targetData.identity}".`,
              sourcePath: `runtimes.${runtime.name}.withData.${targetDataName}`,
            })
          }
        }
        const outputNames = new Set(artifact.payload.outputs.map(output => output.key))
        validateStoreTo(runtime, outputNames, 'Composition')
      }
      else {
        const componentSFC = Endge.domain.getComponentSFC(runtime.identity)
        if (!componentSFC) {
          diagnostics.push({ severity: 'error', code: 'composition-component-sfc-missing', message: `SFC component "${runtime.identity}" не найден. Legacy Table/DSL documents are data-only and cannot be executed.`, sourcePath: `runtimes.${runtime.name}` })
        }
      }
    }

    const runtimeHasOutput = (runtime: CompositionProgramPayload['runtimes'][number] | undefined, output: string): boolean => {
      if (runtime?.kind === 'filter')
        return Endge.program.getFilterArtifact(runtime.identity)?.payload.outputs.some(item => item.key === output) ?? false
      if (runtime?.kind === 'query')
        return Endge.program.getQueryArtifact(runtime.identity)?.payload.outputs.some(item => item.key === output) ?? false
      if (runtime?.kind === 'composition')
        return Endge.program.getCompositionArtifact(runtime.identity)?.payload.outputs.some(item => item.key === output) ?? false
      return false
    }

    for (const output of payload.outputs) {
      if (output.kind !== 'runtime' || !output.output)
        continue
      const runtime = payload.runtimes.find(item => item.name === output.runtime)
      const outputExists = runtimeHasOutput(runtime, output.output)
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
        const outputExists = runtimeHasOutput(source, binding.output)
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
      const outputExists = runtimeHasOutput(source, hook.output)
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

  /** Сортирует Composition так, чтобы compiled artifact зависимости появился раньше consumer. */
  private _orderCompositionsForCompile(compositions: RComposition[]): RComposition[] {
    const byIdentity = new Map(compositions.map(composition => [composition.identity, composition]))
    const ordered: RComposition[] = []
    const visiting = new Set<string>()
    const visited = new Set<string>()

    const visit = (composition: RComposition): void => {
      const identity = String(composition.identity ?? composition.id)
      if (visited.has(identity))
        return
      if (visiting.has(identity))
        return
      visiting.add(identity)
      for (const dependency of this._compositionDependencies(composition)) {
        const child = byIdentity.get(dependency)
        if (child)
          visit(child)
      }
      visiting.delete(identity)
      visited.add(identity)
      ordered.push(composition)
    }

    for (const composition of compositions)
      visit(composition)
    return ordered
  }

  /** Проверяет достижимость Composition dependency для compile-time cycle diagnostics. */
  private _compositionDependsOn(fromIdentity: string, targetIdentity: string, visited = new Set<string>()): boolean {
    if (fromIdentity === targetIdentity)
      return true
    if (visited.has(fromIdentity))
      return false
    visited.add(fromIdentity)
    const model = Endge.domain.getComposition(fromIdentity)
    if (!model)
      return false
    return this._compositionDependencies(model)
      .some(identity => this._compositionDependsOn(identity, targetIdentity, visited))
  }

  /** Читает только прямые Composition dependencies из source без создания Program artifact. */
  private _compositionDependencies(composition: RComposition): string[] {
    const result = Endge.source.compile('composition', this._resolveCompositionSource(composition))
    const payload = result.artifact as CompositionProgramPayload | undefined
    return [...new Set(
      (payload?.runtimes ?? [])
        .filter(runtime => runtime.kind === 'composition')
        .map(runtime => runtime.identity),
    )]
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
      metadata: { self: result.metadata ?? {}, nodes: [] },
      payload,
      diagnostics,
      dependencies,
      children,
    })
  }

  /**
   * Строит стабильную ссылку artifact на исходную доменную сущность.
   *
   * Ссылка используется для diagnostics, indexes и поиска в read-model.
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
      tag: entity?.tag ?? null,
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
      activation: null,
      data: [],
      resources: [],
      scopes: [{
        name: 'scope_default',
        path: 'scope_default',
        parentPath: null,
        activationOverride: null,
        effectiveActivation: { mode: 'startup' },
        resources: [],
        runtimes: [],
        children: [],
        sourceOrder: 0,
      }],
      runtimes: [],
      hooks: [],
      outputs: [],
      graph: { inputs: [], dataInputs: [], updates: [], publications: [], mounts: [] },
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
      output: {},
      expression: null,
    }
  }

  /**
   * Возвращает короткий deterministic hash для source snapshot artifact.
   *
   * Хеш не является криптографическим; он нужен только как дешёвый marker
   * изменения входных данных компиляции.
   */
  private _hashString(value: string): string {
    let hash = 0
    for (let index = 0; index < value.length; index += 1)
      hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0
    return Math.abs(hash).toString(36)
  }
}

function fieldContract(field: { type: string, isArray?: boolean, optional?: boolean } | null | undefined) {
  if (!field) return null
  return {
    type: field.type,
    isArray: field.isArray === true,
    optional: field.optional === true,
  }
}

function uniqueComputationReferences(payload: ComputationProgramPayload): string[] {
  return [...new Set(payload.nodes
    .filter(node => node.kind === 'computation')
    .map(node => node.identity))]
}

function statusFromDiagnostics(diagnostics: ProgramDiagnostic[]): ProgramArtifact['status'] {
  if (diagnostics.some(item => item.severity === 'error'))
    return 'error'
  return diagnostics.length ? 'warning' : 'valid'
}
