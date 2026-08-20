import type { EndgeWorkspaceDefinition } from '@/domain/types/document/workspace.types'

export const TEST_ENDGE_WORKSPACE: EndgeWorkspaceDefinition = {
  identity: 'workspace-test',
  displayName: 'Test Workspace',
  dataMode: 'live',
  managedBy: 'user',
  managedById: null,
  meta: {},
  installedIntegrations: [],
  configuration: {
    values: {},
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
    timezones: [
      { identity: 'local', displayName: 'Local time' },
      { identity: 'UTC', displayName: 'UTC' },
    ],
    defaultTimezone: 'local',
    defaultAuthProfileIdentity: null,
    sfcAdapterIds: ['vue-native'],
    defaultSfcAdapterId: 'vue-native',
    sfcEditing: {
      cancelOn: [
        { event: 'keydown', key: ['Escape'], prevent: true, stop: true },
        { event: 'focusout' },
      ],
      commitOn: [{ event: 'keydown', key: ['Enter'], prevent: true }],
    },
    tooltips: { side: 'right', align: 'start', openDelay: 250, closeDelay: 100 },
    diagnostics: {
      telemetry: {
        collection: {
          enabled: true,
          signals: ['log', 'span'],
          minSeverity: 9,
          maxRecords: 2_000,
        },
        outputs: [],
        routes: [],
      },
      snapshots: {
        content: { telemetry: true, problems: true, configuration: false },
        automatic: {
          enabled: false,
          errorCount: 10,
          windowSeconds: 60,
          cooldownSeconds: 300,
          outputIds: [],
        },
      },
    },
  },
}
