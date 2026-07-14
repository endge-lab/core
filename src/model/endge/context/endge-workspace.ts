import type { EndgeBootContext } from '@/domain/types/kernel/bootstrap.types'
import type {
  EndgeWorkspaceDefinition,
  EndgeWorkspaceLocale,
  EndgeWorkspaceLocaleLabelMode,
  EndgeWorkspaceSSEConfig,
  EndgeWorkspaceVar,
} from '@/domain/types/document/workspace.types'

import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import { normalizeEndgeWorkspaceDefinition } from '@/domain/entities/reflect/RWorkspace'
import { setActiveEndgeWorkspace } from '@/model/config/endge-workspace'
import { Endge } from '@/model/endge/kernel/endge'
import { WorkspaceVariables } from '@/model/endge/context/endge-vars'

/**
 * Модуль workspace-профиля frontend-приложения.
 * Владеет workspace, загруженным из DB.
 */
export class EndgeWorkspace extends EndgeModule {
  private _current: EndgeWorkspaceDefinition | null = null
  public readonly variables = new WorkspaceVariables(() => this._current?.vars ?? [])

  /** Captures environment overrides before the workspace definition is loaded. */
  public override setup(ctx: EndgeBootContext): void {
    this.variables.setEnvironment(ctx.vars)
  }

  /** Строит workspace из загруженного source. */
  public override build(ctx: EndgeBootContext): void {
    if (ctx.dataProvider !== 'payload') {
      throw new Error('[EndgeWorkspace] Workspace can only be loaded from Payload')
    }

    this.apply(selectPayloadWorkspace(
      Endge.schema.getLoadedSource(),
      normalizeOptionalIdentity(ctx.scope.workspaceIdentity)
      ?? Endge.context.getCurrentWorkspace(),
    ))
  }

  /** Очищает загруженный workspace. */
  public override reset(): void {
    this._current = null
    this.variables.setEnvironment({})
    setActiveEndgeWorkspace(null)
    this.notify()
  }

  /** Проверяет, поддерживает ли workspace указанную locale. */
  supportsLocale(locale: string | null | undefined): boolean {
    const code = String(locale ?? '').trim()
    return this.locales.some(item => item.code === code)
  }

  /** Нормализует locale по правилам активного workspace. */
  normalizeLocale(locale: string | null | undefined): string {
    const code = String(locale ?? '').trim()
    return this.supportsLocale(code) ? code : this.defaultLocale
  }

  /** Возвращает label locale в указанном режиме. */
  getLocaleLabel(locale: string, mode: EndgeWorkspaceLocaleLabelMode = 'displayName'): string {
    return this.locales.find(item => item.code === locale)?.[mode] ?? locale
  }

  /** Применяет и публикует новую workspace-конфигурацию. */
  public apply(input: unknown): void {
    const next = normalizeEndgeWorkspaceDefinition(input)
    this._current = next
    setActiveEndgeWorkspace(next)
    Endge.context.setCurrentWorkspace(next.identity)
    Endge.context.reconcileCurrentLocaleWithWorkspace()
    this.notify()
  }

  /** Сериализует текущую workspace-конфигурацию. */
  public override serialize(): EndgeWorkspaceDefinition {
    return this.current
  }

  /** Возвращает workspace или сообщает о нарушении boot lifecycle. */
  private _requireCurrent(): EndgeWorkspaceDefinition {
    if (!this._current)
      throw new Error('[EndgeWorkspace] Workspace has not been loaded from Payload')
    return this._current
  }

  /**
   * ACCESS
   */

  /** Показывает, загружен ли workspace из Payload. */
  get isLoaded(): boolean {
    return this._current != null
  }

  /** Возвращает текущую нормализованную workspace-конфигурацию. */
  get current(): EndgeWorkspaceDefinition {
    return this._requireCurrent()
  }

  /** Возвращает доступные workspace locales. */
  get locales(): EndgeWorkspaceLocale[] {
    return this._requireCurrent().locales
  }

  /** Возвращает определения workspace variables. */
  get vars(): EndgeWorkspaceVar[] {
    return this._requireCurrent().vars
  }

  /** Explicit name for the persisted variable definitions. */
  get variableDefinitions(): EndgeWorkspaceVar[] {
    return this.vars
  }

  /** Возвращает workspace SSE config. */
  get sse(): EndgeWorkspaceSSEConfig | undefined {
    return this._requireCurrent().sse
  }

  /** Возвращает locale по умолчанию. */
  get defaultLocale(): string {
    return this._requireCurrent().defaultLocale
  }

  /** Возвращает fallback locale. */
  get fallbackLocale(): string {
    return this._requireCurrent().fallbackLocale
  }

  /** Возвращает identity auth profile по умолчанию. */
  get defaultAuthProfileIdentity(): string | null {
    return this._requireCurrent().defaultAuthProfileIdentity
  }

  /** Возвращает список разрешённых SFC adapter ids. */
  get sfcAdapterIds(): string[] {
    return this._requireCurrent().sfcAdapterIds
  }

  /** Возвращает SFC adapter id по умолчанию. */
  get defaultSfcAdapterId(): string {
    return this._requireCurrent().defaultSfcAdapterId
  }
}

function selectPayloadWorkspace(source: unknown, requestedIdentity: string | null): unknown {
  if (!isRecord(source))
    throw new Error('[EndgeWorkspace] Payload schema dump is unavailable')

  const workspaces = Array.isArray(source.workspaces) ? source.workspaces : []
  if (!workspaces.length)
    throw new Error('[EndgeWorkspace] Payload collection "workspaces" is empty')

  if (requestedIdentity) {
    const selected = workspaces.find((workspace) => {
      return isRecord(workspace) && String(workspace.identity ?? '').trim() === requestedIdentity
    })
    if (!selected)
      throw new Error(`[EndgeWorkspace] Workspace "${requestedIdentity}" was not found in Payload`)
    return selected
  }

  if (workspaces.length === 1)
    return workspaces[0]

  throw new Error('[EndgeWorkspace] Payload contains multiple workspaces; an explicit workspace identity is required')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeOptionalIdentity(value: unknown): string | null {
  const identity = String(value ?? '').trim()
  return identity || null
}
