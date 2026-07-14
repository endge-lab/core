import { describe, expect, it } from 'vitest'

import { RComponentSFC } from '@/domain/entities/reflect/RComponentSFC'

describe('RComponentSFC tag persistence', () => {
  it('normalizes and serializes an optional direct-call tag', () => {
    const component = RComponentSFC.fromPlain({
      id: 1,
      identity: 'aircraft-tail',
      displayName: 'Aircraft tail',
      tag: '  Module.Tail  ',
      source: '<template><Text>Tail</Text></template>',
    })

    expect(component.tag).toBe('Module.Tail')
    expect(component.toPlain()).toMatchObject({
      identity: 'aircraft-tail',
      tag: 'Module.Tail',
    })
  })

  it('clears tag on duplicate so the draft can be saved before choosing a unique tag', () => {
    const component = RComponentSFC.fromPlain({
      id: 1,
      identity: 'aircraft-tail',
      displayName: 'Aircraft tail',
      tag: 'Tail',
    })

    const copy = component.duplicate({ identity: 'aircraft-tail-copy' })

    expect(copy.tag).toBeNull()
  })
})
