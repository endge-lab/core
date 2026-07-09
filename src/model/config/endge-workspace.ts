import type { EndgeWorkspaceDefinition, EndgeWorkspaceLocale } from '@/domain/types/workspace.types'

export const DEFAULT_ENDGE_WORKSPACE = {
  identity: 'default',
  displayName: 'Default Workspace',
  locales: [
    { code: 'en', label: 'English', nativeLabel: 'English', shortLabel: 'EN' },
    { code: 'ru', label: 'Russian', nativeLabel: 'Русский', shortLabel: 'RU' },
  ],
  defaultLocale: 'ru',
  fallbackLocale: 'ru',
} satisfies EndgeWorkspaceDefinition

export type EndgeWorkspaceLocaleLabelMode = keyof Pick<EndgeWorkspaceLocale, 'label' | 'nativeLabel' | 'shortLabel'>

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
  mode: EndgeWorkspaceLocaleLabelMode = 'label',
): string {
  return ACTIVE_ENDGE_WORKSPACE.locales.find(item => item.code === locale)?.[mode] ?? locale
}
