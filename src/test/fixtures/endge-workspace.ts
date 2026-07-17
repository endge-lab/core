import type { EndgeWorkspaceDefinition } from '@/domain/types/document/workspace.types'

export const TEST_ENDGE_WORKSPACE: EndgeWorkspaceDefinition = {
  identity: 'workspace-test',
  displayName: 'Test Workspace',
  vars: [],
  sse: undefined,
  locales: [
    { code: 'en', displayName: 'English', shortLabel: 'EN' },
    { code: 'ru', displayName: 'Русский', shortLabel: 'RU' },
  ],
  defaultLocale: 'ru',
  fallbackLocale: 'ru',
  themes: [
    { identity: 'light', displayName: 'Светлая' },
    { identity: 'dark', displayName: 'Тёмная' },
  ],
  defaultTheme: 'light',
  defaultAuthProfileIdentity: null,
  sfcAdapterIds: ['native-vue', 'shadcn-vue'],
  defaultSfcAdapterId: 'shadcn-vue',
}
