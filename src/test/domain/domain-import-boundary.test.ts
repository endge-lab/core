import { readdirSync, readFileSync } from 'node:fs'
import { extname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

const DOMAIN_ROOT = join(process.cwd(), 'src/domain')

/** Собирает production TypeScript-файлы Domain без generated и test trees. */
function collectTypeScriptFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name)
    if (entry.isDirectory()) {
      return collectTypeScriptFiles(path)
    }
    return ['.ts', '.tsx'].includes(extname(entry.name)) ? [path] : []
  })
}

describe('domain import boundary', () => {
  /** Запрещает Domain знать о concrete runtime и остальных Model implementations. */
  it('does not import Model implementations', () => {
    const violations = collectTypeScriptFiles(DOMAIN_ROOT).flatMap((path) => {
      const source = readFileSync(path, 'utf8')
      return /from\s+['"]@\/model\//.test(source) ? [path] : []
    })

    expect(violations).toEqual([])
  })
})
