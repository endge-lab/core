import { Raph } from '@raphy-js/raph'
import { beforeEach } from 'vitest'

if (!Raph.configured) {
  Raph.configure({ mode: 'runtime' })
}

// Каждый тест явно начинает новую Runtime-сессию после cleanup предыдущего теста.
beforeEach(() => {
  if (!Raph.configured) {
    Raph.configure({ mode: 'runtime' })
  }
})
