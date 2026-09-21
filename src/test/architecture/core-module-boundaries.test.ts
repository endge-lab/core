import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { extname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

const SRC_ROOT = join(process.cwd(), 'src')
const CORE_ROOT = join(SRC_ROOT, 'features', 'core')
const FEDERATION_ROOT = join(SRC_ROOT, 'features', 'federation')
const MODULES_ROOT = join(CORE_ROOT, 'modules')
const FEDERATION_ROOT_FILES = new Set(['EndgeFederation.ts', 'EndgeModule.ts'])
const FEDERATION_ROLE_DIRECTORIES = new Set(['constants', 'services', 'tools', 'types'])
const LEGACY_PRODUCTION_ROOTS = ['domain', 'kernel', 'model', 'modules', 'tools']
  .map(segment => join(SRC_ROOT, segment))

/** Собирает production TypeScript-файлы без test tree. */
function collectTypeScriptFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name)
    if (entry.isDirectory()) {
      return collectTypeScriptFiles(path)
    }
    return ['.ts', '.tsx'].includes(extname(entry.name)) ? [path] : []
  })
}

/** Находит локальные domain slices всех structured Modules. */
function collectNamedDirectories(root: string, name: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isDirectory()) {
      return []
    }
    const path = join(root, entry.name)
    const isBusinessModuleRoot = root === MODULES_ROOT && entry.name === name
    return [
      ...(entry.name === name && !isBusinessModuleRoot ? [path] : []),
      ...collectNamedDirectories(path, name),
    ]
  })
}

describe('границы Core с приоритетом модулей', () => {
  it('не сохраняет legacy-глобальные production-слои', () => {
    expect(LEGACY_PRODUCTION_ROOTS.filter(existsSync)).toEqual([])
  })

  it('сохраняет локальные domain-срезы независимыми от реализаций и глобального Endge', () => {
    const domainRoots = new Set([
      ...collectNamedDirectories(MODULES_ROOT, 'domain'),
      join(MODULES_ROOT, 'domain', 'component'),
      join(MODULES_ROOT, 'domain', 'documents'),
      join(MODULES_ROOT, 'domain', 'entities'),
      join(MODULES_ROOT, 'domain', 'types'),
    ])
    const forbiddenImport = /(?:from\s+|import\()['"]@\/features\/core\/(?:kernel\/endge|modules\/[^/'"]+\/(?:adapters|services)\/)/
    const violations = [...domainRoots]
      .filter(existsSync)
      .flatMap(collectTypeScriptFiles)
      .filter(path => forbiddenImport.test(readFileSync(path, 'utf8')))

    expect(violations).toEqual([])
  })

  it('использует папки только для структурированных Modules, а файлы — для leaf Modules', () => {
    const entries = readdirSync(MODULES_ROOT, { withFileTypes: true })
    const invalidLeafFiles = entries
      .filter(entry => entry.isFile() && extname(entry.name) === '.ts')
      .map(entry => entry.name)
      .filter(name => !/^Endge.+_Module\.ts$/.test(name))
    const ownerlessFolders = entries
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .filter((name) => {
        const files = readdirSync(join(MODULES_ROOT, name))
        return !files.some(file => /^Endge.+_Module\.ts$/.test(file))
      })

    expect(invalidLeafFiles).toEqual([])
    expect(ownerlessFolders).toEqual([])
  })

  it('сохраняет Federation framework независимым от Core implementation', () => {
    const coreImport = /(?:from\s+|import\()['"]@\/features\/core\//
    const violations = collectTypeScriptFiles(FEDERATION_ROOT)
      .filter(path => coreImport.test(readFileSync(path, 'utf8')))

    expect(violations).toEqual([])
  })

  it('использует owner-first slices для Federation framework', () => {
    const violations = readdirSync(FEDERATION_ROOT, { withFileTypes: true })
      .filter(entry => entry.isDirectory()
        ? !FEDERATION_ROLE_DIRECTORIES.has(entry.name)
        : !FEDERATION_ROOT_FILES.has(entry.name))
      .map(entry => entry.name)

    expect(violations).toEqual([])
  })
})
