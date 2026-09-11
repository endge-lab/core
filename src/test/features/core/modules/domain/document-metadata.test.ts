import { describe, expect, it } from 'vitest'

import { inspectDocumentMetadata, patchDocumentMetadata } from '@/features/core/modules/domain/documents/document-metadata'
import { ComponentType, QueryType } from '@/features/core/modules/domain/types/document/document.types'
import { inspectComponentSFCMetadata, patchComponentSFCMetadataSource } from '@/features/core/modules/source/services/component-sfc/component-sfc-metadata-source-patch'

const metadata = { 'company.feature': { owner: 'operations', flags: [true, null, 3] } }

describe('document metadata authoring', () => {
  it('patches a definition property without rewriting surrounding Source', () => {
    const source = `type Local = string\n\ndefineQuery({\n  kind: 'rest',\n  request: { url: '/orders' },\n  outputs: {},\n})\n`
    const result = patchDocumentMetadata(QueryType.REST, { source, meta: { configurator: { x: 1 } } }, metadata)

    expect(result.ok).toBe(true)
    expect(result.source).toContain(`type Local = string`)
    expect(result.source).toContain(`metadata: {\n    "company.feature"`)
    expect(result.meta).toEqual({ configurator: { x: 1 } })
    expect(inspectDocumentMetadata(QueryType.REST, result).metadata).toEqual(metadata)
  })

  it('inserts a declaration before Type and accepts either declaration order', () => {
    const source = `defineType({\n  identity: field(String),\n})`
    const result = patchDocumentMetadata('type', { source }, metadata)

    expect(result.ok).toBe(true)
    expect(result.source.indexOf('defineMetadata')).toBeLessThan(result.source.indexOf('defineType'))
    expect(inspectDocumentMetadata('type', { source: `${source}\n\ndefineMetadata(${JSON.stringify(metadata)})` }).metadata).toEqual(metadata)
  })

  it('merges meta.user and preserves every system sibling', () => {
    const meta = {
      configurator: { position: [1, 2] },
      endge: { navigation: true },
      legacyNavigation: { hidden: false },
    }
    const result = patchDocumentMetadata('navigation', { meta }, metadata)

    expect(result.ok).toBe(true)
    expect(result.meta).toEqual({ ...meta, user: metadata })
    expect(result.source).toBe('')
  })

  it('does not materialize missing metadata during inspection', () => {
    const source = `defineStore({ data: {} })`
    const projection = inspectDocumentMetadata('store', { source, meta: {} })

    expect(projection.mode).toBe('missing')
    expect(projection.json).toBe('{}')
    expect(source).toBe(`defineStore({ data: {} })`)
  })

  it('blocks duplicate and dynamic metadata', () => {
    const duplicate = inspectDocumentMetadata('store', { source: `defineStore({ metadata: {}, metadata: {}, data: {} })` })
    const dynamic = inspectDocumentMetadata('store', { source: `defineStore({ metadata: getMetadata(), data: {} })` })
    const dynamicDefinition = inspectDocumentMetadata('store', { source: `defineStore(getDefinition())` })

    expect(duplicate.mode).toBe('duplicate')
    expect(duplicate.editable).toBe(false)
    expect(dynamic.mode).toBe('invalid')
    expect(dynamic.editable).toBe(false)
    expect(dynamicDefinition.mode).toBe('invalid')
    expect(dynamicDefinition.editable).toBe(false)
  })

  it('keeps the legacy component SFC API as a wrapper', () => {
    const source = `<script setup lang="ts">\ndefineProps<{ value: string }>()\n</script>\n<template><div /></template>`
    const result = patchComponentSFCMetadataSource(source, metadata)

    expect(result.ok).toBe(true)
    expect(inspectComponentSFCMetadata(result.source).metadata).toEqual(metadata)
    expect(inspectDocumentMetadata(ComponentType.SFC, { source: result.source }).metadata).toEqual(metadata)
  })
})
