import type { EndgeWorkspaceDefinition } from '@/domain/types/document/workspace.types'
import type { EndgeConfiguration } from '@/domain/types/configuration'

let ACTIVE_ENDGE_WORKSPACE: EndgeWorkspaceDefinition | null = null
let ACTIVE_ENDGE_CONFIGURATION: EndgeConfiguration | null = null

export function setActiveEndgeWorkspace(workspace: EndgeWorkspaceDefinition | null): void {
  ACTIVE_ENDGE_WORKSPACE = workspace
  ACTIVE_ENDGE_CONFIGURATION = workspace?.configuration ?? null
}

export function setActiveEndgeConfiguration(configuration: EndgeConfiguration | null): void {
  ACTIVE_ENDGE_CONFIGURATION = configuration
}

export function hasActiveEndgeWorkspace(): boolean {
  return ACTIVE_ENDGE_WORKSPACE != null
}

export function getActiveEndgeWorkspace(): EndgeWorkspaceDefinition {
  if (!ACTIVE_ENDGE_WORKSPACE)
    throw new Error('[EndgeWorkspace] Workspace has not been loaded from Payload')
  return ACTIVE_ENDGE_WORKSPACE
}

export function normalizeWorkspaceLocale(locale: string | null | undefined): string {
  const configuration = getActiveEndgeConfiguration()
  const code = String(locale ?? '').trim()
  return configuration.locales.some(item => item.code === code) ? code : configuration.defaultLocale
}

export function normalizeWorkspaceTheme(theme: string | null | undefined): string {
  const configuration = getActiveEndgeConfiguration()
  const identity = String(theme ?? '').trim()
  return configuration.themes.some(item => item.identity === identity) ? identity : configuration.defaultTheme
}

export function getActiveEndgeConfiguration(): EndgeConfiguration {
  if (ACTIVE_ENDGE_CONFIGURATION)
    return ACTIVE_ENDGE_CONFIGURATION
  return getActiveEndgeWorkspace().configuration
}
