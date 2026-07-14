import type { EndgeMockRegistration } from '@/domain/types/mock'

import groundHandling from '@/mock/groundhandling.mock.json'

/** Временный manifest встроенных mock payload ядра. */
export const ENDGE_BUILTIN_MOCKS: EndgeMockRegistration[] = [
  {
    identity: 'groundhandling',
    description: 'Ground Handling preview data',
    data: groundHandling,
  },
]
