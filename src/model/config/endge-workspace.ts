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

export function supportsWorkspaceLocale(locale: string | null | undefined): boolean {
  const code = String(locale ?? '').trim()
  return DEFAULT_ENDGE_WORKSPACE.locales.some(item => item.code === code)
}

export function normalizeWorkspaceLocale(locale: string | null | undefined): string {
  const code = String(locale ?? '').trim()
  return supportsWorkspaceLocale(code) ? code : DEFAULT_ENDGE_WORKSPACE.defaultLocale
}

export function getWorkspaceLocaleLabel(
  locale: string,
  mode: EndgeWorkspaceLocaleLabelMode = 'label',
): string {
  return DEFAULT_ENDGE_WORKSPACE.locales.find(item => item.code === locale)?.[mode] ?? locale
}
