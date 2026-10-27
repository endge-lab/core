import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { createTenantInspectorBundle } from '@/test/fixtures/tenant-inspector-bundle'

// Пример cookbook «Инспектор по тенантам АФЛ/КЗН» публикуется документацией Endge как
// docs/public/examples/tenant-inspector.json. Файл обязан совпадать с fixture интеграционного
// теста: иначе пользователь импортирует не тот workspace, который проверяет core.
// Документация — соседний репозиторий монорепозитория; в отдельном checkout core файла нет,
// и сверка пропускается.
const DOCS_EXAMPLE_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../../../../../apps/egorkozelskij-endge-web-configurator-docs/docs/public/examples/tenant-inspector.json',
)

describe.skipIf(!existsSync(DOCS_EXAMPLE_PATH))('tenant inspector docs example', () => {
  it('matches the core fixture byte for byte', () => {
    // Обновление файла: JSON.stringify(createTenantInspectorBundle(), null, 2) + '\n'.
    const expected = `${JSON.stringify(createTenantInspectorBundle(), null, 2)}\n`
    expect(readFileSync(DOCS_EXAMPLE_PATH, 'utf8')).toBe(expected)
  })
})
