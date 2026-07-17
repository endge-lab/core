import { describe, expect, it } from 'vitest'

import { RComponentSFC } from '@/domain/entities/reflect/RComponentSFC'
import { componentSFCPayloadDocToPlain } from '@/model/endge/schema/endge-schema-database'

describe('component SFC Payload hydration', () => {
  it('preserves the persisted tag during bulk schema loading', () => {
    const plain = componentSFCPayloadDocToPlain({
      id: 5,
      identity: 'tail',
      displayName: 'Tail',
      tag: '  Module.Tail  ',
      folder: { id: 10 },
      project: { id: 7 },
      source: '<template><Text>Tail</Text></template>',
      supportedTargets: ['dom', 'canvas'],
    })

    const component = RComponentSFC.fromPlain(plain)

    expect(plain.tag).toBe('Module.Tail')
    expect(plain).not.toHaveProperty('project')
    expect(component.tag).toBe('Module.Tail')
    expect(component).not.toHaveProperty('project')
  })
})
