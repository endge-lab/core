import { bench, describe } from 'vitest'

import type { ComponentSFCInteractionTriggerEvent } from '@/domain/types/component/sfc/ir.types'
import {
  matchesComponentSFCInteractionTrigger,
  normalizeComponentSFCInteractionTriggers,
} from '@/tools/component-sfc-edit-trigger'
import { ComponentSFCEventBoundary } from '@/domain/entities/runtime/ComponentSFCEventBoundary'
import { createEmptyComponentSFCPortManifest } from '@/domain/types/component/sfc/ports.types'

const occurrence: ComponentSFCInteractionTriggerEvent = {
  key: 'e',
  code: 'KeyE',
  repeat: false,
  composing: false,
  button: 0,
  targetIsCurrentTarget: true,
  held: { key: ['w'], code: ['KeyW'] },
  modifiers: { ctrl: false, shift: true, alt: false, meta: false, altGraph: false },
}

describe('Component SFC interaction matcher benchmarks', () => {
  for (const size of [1, 16, 100]) {
    const rules = normalizeComponentSFCInteractionTriggers(Array.from({ length: size }, (_item, index) => ({
      event: 'click',
      code: index === size - 1 ? ['KeyE'] : [`Key${index}`],
      held: { code: ['KeyW'], exact: true },
      modifiers: { shift: true, exact: true },
      button: 0,
    })))
    bench(`first-match selection / ${size} rules`, () => {
      rules.find(rule => matchesComponentSFCInteractionTrigger(rule, occurrence, 'linux'))
    })
  }

  const boundary = new ComponentSFCEventBoundary({
    publishEventPort: () => undefined,
    executeEventPortAction: async () => true,
    emit: () => undefined,
  } as any, 'bench', createEmptyComponentSFCPortManifest())
  const actions = Array.from({ length: 16 }, (_item, index) => ({ kind: 'action' as const, identity: `bench.${index}` }))
  bench('sequential dispatch / 16 reactions', async () => {
    await boundary.routeChild(
      { nodeId: 'bench', componentTag: 'Text' },
      'click',
      { type: 'click' },
      [{ name: 'click', modifiers: [], action: actions[0]!, actions }],
    )
  })
})
