import type { EndgeBootContext } from '@/features/core/kernel/types/bootstrap.types'
import type {
  EndgeBuildContext,
  EndgeConfiguration,
  EndgeConfigurationContribution,
  EndgeConfigurationLayer,
} from '@/features/core/modules/configuration/domain/types/configuration.type'
import type { EndgeExecutionContext } from '@/features/core/modules/runtime/domain/execution-context.types'

import { Endge } from '@/features/core/kernel/endge'
import {
  applyEndgeConfigurationContribution,
  createEndgeContextHash,
  normalizeEndgeConfiguration,
} from '@/features/core/modules/configuration/domain/endge-configuration'
import { EndgeModule } from '@/features/federation/EndgeModule'

const EMPTY_CONTRIBUTION: EndgeConfigurationContribution = { mode: 'inherit', patch: {} }

/**
 * Владеет effective configuration и immutable build context одного boot lifecycle.
 */
export class EndgeConfiguration_Module extends EndgeModule<EndgeBootContext> {
  private _current: EndgeConfiguration | null = null
  private _buildContext: EndgeBuildContext | null = null

  /**
   * Разрешает Workspace и выбранные документы активных фасетов до compiler build.
   */
  public override build(ctx: EndgeBootContext): void {
    if (ctx.mode === 'debugger') {
      return
    }
    const { configuration } = this._buildContext = ctx.deliveryProgram
      ? this._resolveDeliveryContext(ctx.deliveryProgram)
      : this._resolveBuildContext(ctx.context)
    this._current = configuration
    Endge.context.reconcileCurrentLocaleWithWorkspace(configuration)
    Endge.context.reconcileCurrentThemeWithWorkspace(configuration)
    Endge.context.reconcileCurrentTimezoneWithWorkspace(configuration)
    this.notify()
  }

  private _resolveDeliveryContext(program: NonNullable<EndgeBootContext['deliveryProgram']>): EndgeBuildContext {
    const facets = program.context.facets
    const execution = Endge.context.resolveExecutionContext({
      explicit: { facets },
      facets: Object.entries(facets).map(([identity, value], position) => ({ identity, position, documents: [value] })),
    })
    const workspaceIdentity = Endge.workspace.current.identity
    const configuration = normalizeEndgeConfiguration(program.context.configuration)
    return { workspaceIdentity, execution, configuration, contextHash: createEndgeContextHash({ workspaceIdentity, execution, configuration }) }
  }

  public availableFacets() {
    return this._activeFacets().map(facet => ({
      identity: facet.identity,
      position: facet.position,
      documents: Endge.domain.getFacetDocuments(facet.identity)
        .filter(document => document.active !== false && !document.deletedAt)
        .map(document => document.identity),
    }))
  }

  public refreshRuntimeRenderers(): void {
    if (!this._current || !this._buildContext || Endge.mode === 'debugger') {
      return
    }
    let configuration = normalizeEndgeConfiguration(Endge.workspace.current.configuration)
    for (const facet of this._activeFacets()) {
      const identity = this._buildContext.execution.facets[facet.identity]
      const document = identity ? Endge.domain.getFacetDocument(facet.identity, identity) : null
      if (document?.active !== false && !document?.deletedAt) {
        configuration = applyEndgeConfigurationContribution(configuration, document?.configuration ?? EMPTY_CONTRIBUTION)
      }
    }
    if (JSON.stringify(configuration.defaultRenderers) !== JSON.stringify(this._current.defaultRenderers)) {
      this._current = { ...this._current, defaultRenderers: configuration.defaultRenderers }
      this.notify()
    }
  }

  public withBuildContext<T>(facets: EndgeExecutionContext['facets'], compile: () => T): T {
    const previous = this.buildContext
    try {
      this._buildContext = this._resolveBuildContext({ facets }, false)
      this._current = this._buildContext.configuration
      return compile()
    }
    finally {
      this._buildContext = previous
      this._current = previous.configuration
      Endge.configurationSchema.resolveValues(previous.configuration.values)
    }
  }

  private _resolveBuildContext(explicit?: Partial<EndgeExecutionContext>, persist = true): EndgeBuildContext {
    const execution = Endge.context.resolveExecutionContext({ explicit, facets: this.availableFacets() }, { persist })
    if (!persist && Object.entries(explicit?.facets ?? {}).some(([facet, value]) => execution.facets[facet] !== value)) {
      throw new Error('[EndgeConfiguration] Build context conflicts with the session facets')
    }

    let configuration = normalizeEndgeConfiguration(Endge.workspace.current.configuration)
    configuration.values = Endge.configurationSchema.resolveValues(configuration.values)
    for (const facet of this._activeFacets()) {
      const documentIdentity = execution.facets[facet.identity]
      if (!documentIdentity) {
        continue
      }
      const document = Endge.domain.getFacetDocument(facet.identity, documentIdentity)
      if (!document || document.active === false || document.deletedAt) {
        throw new Error(`[EndgeConfiguration] Facet document "${facet.identity}:${documentIdentity}" was not found in loaded Domain`)
      }
      configuration = applyEndgeConfigurationContribution(configuration, document.configuration ?? EMPTY_CONTRIBUTION)
      configuration.values = Endge.configurationSchema.resolveValues(configuration.values)
    }

    const workspaceIdentity = Endge.workspace.current.identity
    return {
      workspaceIdentity,
      execution: { ...execution },
      configuration,
      contextHash: createEndgeContextHash({ workspaceIdentity, execution, configuration }),
    }
  }

  /**
   * Очищает effective configuration перед следующим boot.
   */
  public override reset(): void {
    this._current = null
    this._buildContext = null
    this.notify()
  }

  /**
   * Принимает уже разрешённую конфигурацию клиента без build, команд и запуска приложения.
   */
  public applyInspection(configuration: EndgeConfiguration): void {
    if (Endge.mode !== 'debugger') {
      throw new Error('[EndgeConfiguration] Inspection requires debugger mode')
    }
    this._current = normalizeEndgeConfiguration(configuration)
    this._buildContext = null
    this.notify()
  }

  /**
   * Включает effective configuration текущего build в диагностическое дерево.
   */
  public override createDiagnosticsSnapshot(): EndgeConfiguration {
    return this.current
  }

  /**
   * Возвращает effective configuration текущего build.
   */
  public get current(): EndgeConfiguration {
    if (!this._current) {
      throw new Error('[EndgeConfiguration] Configuration has not been resolved')
    }
    return this._current
  }

  /**
   * Возвращает immutable compiler input текущего build.
   */
  public get buildContext(): EndgeBuildContext {
    if (!this._buildContext) {
      if (Endge.mode === 'debugger' && this._current) {
        const workspaceIdentity = Endge.workspace.current.identity
        const execution = Endge.context.getExecutionContext()
        const configuration = this._current
        return { workspaceIdentity, execution, configuration, contextHash: createEndgeContextHash({ workspaceIdentity, execution, configuration }) }
      }
      throw new Error('[EndgeConfiguration] Build context has not been resolved')
    }
    return this._buildContext
  }

  /**
   * Показывает, завершено ли configuration resolution.
   */
  public get isResolved(): boolean {
    return this._current != null
  }

  /**
   * Нормализует locale относительно effective configuration.
   */
  public normalizeLocale(locale: string | null | undefined): string {
    const value = String(locale ?? '').trim()
    return this.current.locales.some(item => item.code === value) ? value : this.current.defaultLocale
  }

  /**
   * Нормализует theme относительно effective configuration.
   */
  public normalizeTheme(theme: string | null | undefined): string {
    const value = String(theme ?? '').trim()
    return this.current.themes.some(item => item.identity === value) ? value : this.current.defaultTheme
  }

  /**
   * Нормализует timezone относительно effective configuration.
   */
  public normalizeTimezone(timezone: string | null | undefined): string {
    const value = String(timezone ?? '').trim()
    return this.current.timezones.some(item => item.identity === value) ? value : this.current.defaultTimezone
  }

  /**
   * Вычисляет upstream snapshot для общего редактора указанного слоя.
   */
  public resolveUpstream(layer: EndgeConfigurationLayer): EndgeConfiguration {
    let configuration = normalizeEndgeConfiguration(Endge.workspace.current.configuration)
    configuration.values = Endge.configurationSchema.resolveValues(configuration.values)
    if (layer === 'workspace') {
      return configuration
    }

    const execution = Endge.context.getExecutionContext()
    const target = String(layer.facetIdentity ?? '').trim()
    if (!target || !this._activeFacets().some(facet => facet.identity === target)) {
      throw new Error(`[EndgeConfiguration] Facet "${target}" was not found in loaded Domain`)
    }
    for (const facet of this._activeFacets()) {
      if (facet.identity === target) {
        return configuration
      }
      const documentIdentity = execution.facets[facet.identity]
      const document = documentIdentity
        ? Endge.domain.getFacetDocument(facet.identity, documentIdentity)
        : null
      configuration = applyEndgeConfigurationContribution(
        configuration,
        document?.configuration ?? EMPTY_CONTRIBUTION,
      )
      configuration.values = Endge.configurationSchema.resolveValues(configuration.values)
    }
    return configuration
  }

  /**
   * Строит preview без изменения активной конфигурации запуска.
   */
  public preview(upstream: EndgeConfiguration, contribution: EndgeConfigurationContribution): EndgeConfiguration {
    const result = applyEndgeConfigurationContribution(upstream, contribution)
    result.values = Endge.configurationSchema.resolveValues(result.values)
    return result
  }

  private _activeFacets() {
    return Endge.domain.getFacets()
      .filter(facet => facet.active !== false && !facet.deletedAt)
      .sort((left, right) => left.position - right.position || left.identity.localeCompare(right.identity))
  }
}
