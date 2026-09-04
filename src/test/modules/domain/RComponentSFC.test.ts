import { describe, expect, it } from 'vitest'

import { RComponentSFC } from '@/modules/domain/entities/RComponentSFC'

describe('сохранение тега RComponentSFC', () => {
  it('нормализует и сериализует необязательный тег прямого вызова', () => {
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

  it('очищает тег при дублировании, чтобы черновик можно было сохранить до выбора уникального тега', () => {
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
