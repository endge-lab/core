import type { EndgeWorkspaceDefinition } from '@/domain/types/document/workspace.types'

let ACTIVE_ENDGE_WORKSPACE: EndgeWorkspaceDefinition | null = null

export function setActiveEndgeWorkspace(workspace: EndgeWorkspaceDefinition | null): void {
  ACTIVE_ENDGE_WORKSPACE = workspace
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
  const workspace = getActiveEndgeWorkspace()
  const code = String(locale ?? '').trim()
  return workspace.locales.some(item => item.code === code) ? code : workspace.defaultLocale
}

export function normalizeWorkspaceTheme(theme: string | null | undefined): string {
  const workspace = getActiveEndgeWorkspace()
  const identity = String(theme ?? '').trim()
  return workspace.themes.some(item => item.identity === identity) ? identity : workspace.defaultTheme
}
