import type {
  EndgeBuildContext,
  EndgeConfiguration,
  EndgeConfigurationContribution,
  EndgeConfigurationLayer,
} from '@/domain/types/configuration'
import type { EndgeBootContext } from '@/domain/types/kernel/bootstrap.types'

import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import { setActiveEndgeConfiguration } from '@/model/config/endge-workspace'
import { Endge } from '@/model/endge/kernel/endge'
import {
  applyEndgeConfigurationContribution,
  createEndgeContextHash,
  normalizeEndgeConfiguration,
} from '@/model/services/configuration'

const EMPTY_CONTRIBUTION: EndgeConfigurationContribution = { mode: 'inherit', patch: {} }

/** Владеет effective configuration и immutable build context одного boot lifecycle. */
export class EndgeConfigurationModule extends EndgeModule {
  private _current: EndgeConfiguration | null = null
  private _buildContext: EndgeBuildContext | null = null

  /** Разрешает Workspace → Project → Environment → Tenant до compiler build. */
  public override build(ctx: EndgeBootContext): void {
    const execution = Endge.context.getExecutionContext()
    const project = this._resolveEntity('Project', execution.projectIdentity, ctx.context?.projectIdentity != null, identity => Endge.domain.getProject(identity))
    const environment = this._resolveEntity('Environment', execution.environmentIdentity, ctx.context?.environmentIdentity != null, identity => Endge.domain.getEnvironment(identity))
    const tenant = this._resolveEntity('Tenant', execution.tenantIdentity, ctx.context?.tenantIdentity != null, identity => Endge.domain.getTenant(identity))

    if (project && environment && project.allowedEnvironmentIds.length > 0 && !project.allowedEnvironmentIds.includes(Number(environment.id))) {
      throw new Error(`[EndgeConfiguration] Environment "${environment.identity}" is not allowed for Project "${project.identity}"`)
    }

    let configuration = normalizeEndgeConfiguration(Endge.workspace.current.configuration)
    configuration = applyEndgeConfigurationContribution(configuration, project?.configuration ?? EMPTY_CONTRIBUTION)
    configuration = applyEndgeConfigurationContribution(configuration, environment?.configuration ?? EMPTY_CONTRIBUTION)
    configuration = applyEndgeConfigurationContribution(configuration, tenant?.configuration ?? EMPTY_CONTRIBUTION)

    const workspaceIdentity = Endge.workspace.current.identity
    this._current = configuration
    this._buildContext = {
      workspaceIdentity,
      execution: { ...execution },
      configuration,
      contextHash: createEndgeContextHash({ workspaceIdentity, execution, configuration }),
    }
    setActiveEndgeConfiguration(configuration)
    Endge.context.reconcileCurrentLocaleWithWorkspace()
    Endge.context.reconcileCurrentThemeWithWorkspace()
    this.notify()
  }

  /** Очищает effective configuration перед следующим boot. */
  public override reset(): void {
    this._current = null
    this._buildContext = null
    setActiveEndgeConfiguration(null)
    this.notify()
  }

  /** Возвращает effective configuration текущего build. */
  get current(): EndgeConfiguration {
    if (!this._current)
      throw new Error('[EndgeConfiguration] Configuration has not been resolved')
    return this._current
  }

  /** Возвращает immutable compiler input текущего build. */
  get buildContext(): EndgeBuildContext {
    if (!this._buildContext)
      throw new Error('[EndgeConfiguration] Build context has not been resolved')
    return this._buildContext
  }

  /** Показывает, завершено ли configuration resolution. */
  get isResolved(): boolean {
    return this._current != null
  }

  /** Нормализует locale относительно effective configuration. */
  normalizeLocale(locale: string | null | undefined): string {
    const value = String(locale ?? '').trim()
    return this.current.locales.some(item => item.code === value) ? value : this.current.defaultLocale
  }

  /** Нормализует theme относительно effective configuration. */
  normalizeTheme(theme: string | null | undefined): string {
    const value = String(theme ?? '').trim()
    return this.current.themes.some(item => item.identity === value) ? value : this.current.defaultTheme
  }

  /** Вычисляет upstream snapshot для общего редактора указанного слоя. */
  resolveUpstream(layer: EndgeConfigurationLayer): EndgeConfiguration {
    let configuration = normalizeEndgeConfiguration(Endge.workspace.current.configuration)
    if (layer === 'workspace' || layer === 'project')
      return configuration

    const execution = Endge.context.getExecutionContext()
    configuration = applyEndgeConfigurationContribution(
      configuration,
      Endge.domain.getProject(execution.projectIdentity)?.configuration ?? EMPTY_CONTRIBUTION,
    )
    if (layer === 'environment')
      return configuration

    configuration = applyEndgeConfigurationContribution(
      configuration,
      Endge.domain.getEnvironment(execution.environmentIdentity)?.configuration ?? EMPTY_CONTRIBUTION,
    )
    return configuration
  }

  /** Builds a preview without mutating active boot configuration. */
  preview(upstream: EndgeConfiguration, contribution: EndgeConfigurationContribution): EndgeConfiguration {
    return applyEndgeConfigurationContribution(upstream, contribution)
  }

  private _resolveEntity<TEntity>(
    label: string,
    identity: string,
    required: boolean,
    resolve: (identity: string) => TEntity | null,
  ): TEntity | null {
    const entity = resolve(identity)
    if (!entity && required)
      throw new Error(`[EndgeConfiguration] ${label} "${identity}" was not found in loaded Domain`)
    return entity
  }
}
