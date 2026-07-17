import { describe, expect, it } from 'vitest'

import { normalizeEndgeWorkspaceDefinition } from '@/domain/entities/reflect/RWorkspace'
import { normalizePayloadWorkspace } from '@/model/endge/schema/endge-schema-database'

describe('Payload workspace schema mapping', () => {
  it('preserves themes before the workspace boot phase', () => {
    const payloadWorkspace = {
      id: 1,
      identity: 'default',
      displayName: 'Default Workspace',
      vars: [],
      locales: [{ identity: 'ru', displayName: 'Русский', code: 'ru', shortLabel: 'RU' }],
      defaultLocale: 'ru',
      fallbackLocale: 'ru',
      themes: [
        { identity: 'light', displayName: 'Светлая', id: 'payload-row-light' },
        { identity: 'dark', displayName: 'Тёмная', id: 'payload-row-dark' },
      ],
      defaultTheme: 'light',
      sfcAdapterIds: ['native-vue'],
      defaultSfcAdapterId: 'native-vue',
    }

    const mapped = normalizePayloadWorkspace(payloadWorkspace)
    const workspace = normalizeEndgeWorkspaceDefinition(mapped)

    expect(mapped.themes).toEqual(payloadWorkspace.themes)
    expect(mapped.defaultTheme).toBe('light')
    expect(workspace.themes).toEqual([
      { identity: 'light', displayName: 'Светлая' },
      { identity: 'dark', displayName: 'Тёмная' },
    ])
  })
})
