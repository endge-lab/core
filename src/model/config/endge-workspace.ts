import type { EndgeWorkspaceDefinition, EndgeWorkspaceLocale } from '@/domain/types/workspace.types'

export const DEFAULT_ENDGE_WORKSPACE = {
  identity: 'default',
  displayName: 'Default Workspace',
  vars: [],
  sse: undefined,
  locales: [
    { code: 'en', displayName: 'English', shortLabel: 'EN' },
    { code: 'ru', displayName: 'Русский', shortLabel: 'RU' },
  ],
  defaultLocale: 'ru',
  fallbackLocale: 'ru',
  defaultAuthProfileIdentity: null,
} satisfies EndgeWorkspaceDefinition

export type EndgeWorkspaceLocaleLabelMode = keyof Pick<EndgeWorkspaceLocale, 'displayName' | 'shortLabel'>

let ACTIVE_ENDGE_WORKSPACE: EndgeWorkspaceDefinition = DEFAULT_ENDGE_WORKSPACE

export function setActiveEndgeWorkspace(workspace: EndgeWorkspaceDefinition): void {
  ACTIVE_ENDGE_WORKSPACE = workspace
}

export function getActiveEndgeWorkspace(): EndgeWorkspaceDefinition {
  return ACTIVE_ENDGE_WORKSPACE
}

export function supportsWorkspaceLocale(locale: string | null | undefined): boolean {
  const code = String(locale ?? '').trim()
  return ACTIVE_ENDGE_WORKSPACE.locales.some(item => item.code === code)
}

export function normalizeWorkspaceLocale(locale: string | null | undefined): string {
  const code = String(locale ?? '').trim()
  return supportsWorkspaceLocale(code) ? code : ACTIVE_ENDGE_WORKSPACE.defaultLocale
}

export function getWorkspaceLocaleLabel(
  locale: string,
  mode: EndgeWorkspaceLocaleLabelMode = 'displayName',
): string {
  return ACTIVE_ENDGE_WORKSPACE.locales.find(item => item.code === locale)?.[mode] ?? locale
}
