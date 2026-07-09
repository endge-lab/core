import type { EndgeWorkspaceDefinition, EndgeWorkspaceLocale } from '@/domain/types/workspace.types'
import type { EndgeWorkspaceLocaleLabelMode } from '@/model/config/endge-workspace'

import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import {
  DEFAULT_ENDGE_WORKSPACE,
  getWorkspaceLocaleLabel,
  normalizeWorkspaceLocale,
  supportsWorkspaceLocale,
} from '@/model/config/endge-workspace'

/**
 * Frontend workspace profile. V1 is hardcoded and does not filter domain data.
 */
export class EndgeWorkspace extends EndgeModule {
  private readonly _current = DEFAULT_ENDGE_WORKSPACE

  get current(): EndgeWorkspaceDefinition {
    return this._current
  }

  get locales(): EndgeWorkspaceLocale[] {
    return this._current.locales
  }

  get defaultLocale(): string {
    return this._current.defaultLocale
  }

  get fallbackLocale(): string {
    return this._current.fallbackLocale
  }

  supportsLocale(locale: string | null | undefined): boolean {
    return supportsWorkspaceLocale(locale)
  }

  normalizeLocale(locale: string | null | undefined): string {
    return normalizeWorkspaceLocale(locale)
  }

  getLocaleLabel(locale: string, mode: EndgeWorkspaceLocaleLabelMode = 'label'): string {
    return getWorkspaceLocaleLabel(locale, mode)
  }
}
