import type { EndgeBootContext } from '@/domain/types/bootstrap.types'
import type {
  EndgeWorkspaceDefinition,
  EndgeWorkspaceLocale,
  EndgeWorkspaceSSEConfig,
  EndgeWorkspaceVar,
} from '@/domain/types/workspace.types'
import type { EndgeWorkspaceLocaleLabelMode } from '@/model/config/endge-workspace'

import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import { normalizeEndgeWorkspaceDefinition } from '@/domain/entities/reflect/RWorkspace'
import {
  DEFAULT_ENDGE_WORKSPACE,
  getActiveEndgeWorkspace,
  getWorkspaceLocaleLabel,
  normalizeWorkspaceLocale,
  setActiveEndgeWorkspace,
  supportsWorkspaceLocale,
} from '@/model/config/endge-workspace'
import { Endge } from '@/model/endge/endge'

/**
 * Frontend workspace profile. It is normalized from plain boot source or payload schema dump.
 */
export class EndgeWorkspace extends EndgeModule {
  private _current: EndgeWorkspaceDefinition = normalizeEndgeWorkspaceDefinition(DEFAULT_ENDGE_WORKSPACE)

  public override load(ctx: EndgeBootContext): void {
    if (ctx.dataProvider !== 'plain')
      return

    this.apply(extractWorkspaceSource(ctx.plainSource))
  }

  public override build(ctx: EndgeBootContext): void {
    if (ctx.dataProvider !== 'payload')
      return

    this.apply(extractWorkspaceSource(Endge.schema.getLoadedSource()))
  }

  public override reset(): void {
    this.apply(DEFAULT_ENDGE_WORKSPACE)
  }

  get current(): EndgeWorkspaceDefinition {
    return this._current
  }

  get locales(): EndgeWorkspaceLocale[] {
    return this._current.locales
  }

  get vars(): EndgeWorkspaceVar[] {
    return this._current.vars
  }

  get sse(): EndgeWorkspaceSSEConfig | undefined {
    return this._current.sse
  }

  get defaultLocale(): string {
    return this._current.defaultLocale
  }

  get fallbackLocale(): string {
    return this._current.fallbackLocale
  }

  get defaultAuthProfileIdentity(): string | null {
    return this._current.defaultAuthProfileIdentity
  }

  supportsLocale(locale: string | null | undefined): boolean {
    return supportsWorkspaceLocale(locale)
  }

  normalizeLocale(locale: string | null | undefined): string {
    return normalizeWorkspaceLocale(locale)
  }

  getLocaleLabel(locale: string, mode: EndgeWorkspaceLocaleLabelMode = 'displayName'): string {
    return getWorkspaceLocaleLabel(locale, mode)
  }

  public apply(input: unknown): void {
    const next = normalizeEndgeWorkspaceDefinition(input ?? DEFAULT_ENDGE_WORKSPACE)
    this._current = next
    setActiveEndgeWorkspace(next)
    Endge.context.reconcileCurrentLocaleWithWorkspace()
    this.notify()
  }

  public override serialize(): EndgeWorkspaceDefinition {
    return this.current
  }

  public override deserialize(payload: unknown): void {
    this.apply(payload)
  }
}

function extractWorkspaceSource(source: unknown): unknown {
  if (!isRecord(source))
    return DEFAULT_ENDGE_WORKSPACE

  const direct = source.workspace ?? source.currentWorkspace
  if (direct)
    return direct

  const workspaces = Array.isArray(source.workspaces) ? source.workspaces : []
  if (workspaces.length > 0)
    return workspaces[0]

  const nested = source.domain
  if (isRecord(nested))
    return extractWorkspaceSource(nested)

  return getActiveEndgeWorkspace()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}
