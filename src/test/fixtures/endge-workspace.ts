import type { EndgeWorkspaceDefinition } from '@/domain/types/document/workspace.types'

export const TEST_ENDGE_WORKSPACE: EndgeWorkspaceDefinition = {
  identity: 'workspace-test',
  displayName: 'Test Workspace',
  configuration: {
    vars: [],
    locales: [
      { code: 'en', displayName: 'English', shortLabel: 'EN', direction: 'ltr' },
      { code: 'ru', displayName: 'Русский', shortLabel: 'RU', direction: 'ltr' },
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
    diagnostics: {
      collection: {
        enabled: true,
        signals: ['log', 'span'],
        minSeverity: 9,
        maxRecords: 2_000,
      },
      routes: [],
    },
  },
}
