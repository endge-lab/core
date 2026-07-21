import { describe, expect, it } from 'vitest'

import {
  inspectComponentSFCPortsSource,
  patchComponentSFCPortsSource,
} from '@/model/services/source-engine/component-sfc/component-sfc-ports-source-patch'

const template = `<template><Table ref="table" :rows="rows" /></template>`

describe('Component SFC Ports Source patch', () => {
  it('creates definePorts and round-trips an Event with direct Action', () => {
    const source = `<script setup lang="ts">\nconst untouched = 1 // оставить\n</script>\n${template}`
    const result = patchComponentSFCPortsSource(source, {
      type: 'set-event',
      name: 'rowActivated',
      payloadType: 'TableRowActivatedEvent',
      from: { ref: 'table', event: 'rowActivated' },
      actionSource: `{ identity: 'flight.open', input: { id: event('rowId') } }`,
    })

    expect(result.ok).toBe(true)
    expect(result.source).toContain('const untouched = 1 // оставить')
    expect(result.source).toContain('rowActivated: event<TableRowActivatedEvent>')
    expect(result.projection.manifest.emits.events[0]?.action?.kind).toBe('action')
  })

  it('removes only an attached reaction and preserves the Event contract', () => {
    const source = `<script setup lang="ts">
const ports = definePorts({
  emits: {
    // публичный контракт сохраняется
    opened: event<{ id: string }>({ action: { identity: 'open', input: event() } }),
  },
})
</script>
${template}`
    const result = patchComponentSFCPortsSource(source, { type: 'remove-event-action', name: 'opened' })

    expect(result.ok).toBe(true)
    expect(result.source).toContain('// публичный контракт сохраняется')
    expect(result.source).toContain('opened: event<{ id: string }>()')
    expect(result.projection.manifest.emits.events[0]?.action).toBeUndefined()
  })

  it('round-trips CRUD for require, provides, emits and forward without rewriting unrelated source', () => {
    const original = `<script setup lang="ts">
// этот комментарий не принадлежит definePorts
const untouched = { value: 1 }
const ports = definePorts({})
</script>
${template}`
    const options = {
      resolvePortProvider: (identity: string) => ({
        kind: 'action' as const,
        identity,
        active: true,
        input: null,
        output: null,
      }),
    }

    let result = patchComponentSFCPortsSource(original, {
      type: 'upsert-port',
      role: 'require',
      name: 'openDetails',
      declaration: `action<unknown, void>({ default: 'flight.open-details' })`,
    }, options)
    expect(result.ok).toBe(true)

    result = patchComponentSFCPortsSource(result.source, {
      type: 'upsert-port',
      role: 'provides',
      name: 'refresh',
      declaration: 'action<unknown, void>()',
    }, options)
    expect(result.ok).toBe(true)

    result = patchComponentSFCPortsSource(result.source, {
      type: 'set-event',
      name: 'rowActivated',
      payloadType: 'TableRowActivatedEvent',
      from: { ref: 'table', event: 'rowActivated' },
    }, options)
    expect(result.ok).toBe(true)

    result = patchComponentSFCPortsSource(result.source, {
      type: 'set-forward',
      declaration: `{ from: 'table', ports: { emits: ['sortChanged'] } }`,
    }, options)
    expect(result.ok).toBe(true)
    expect(result.projection.manifest.require.actions.map(item => item.name)).toEqual(['openDetails'])
    expect(result.projection.manifest.provides.actions.map(item => item.name)).toEqual(['refresh'])
    expect(result.projection.manifest.emits.events.map(item => item.name)).toEqual(['rowActivated', 'sortChanged'])

    result = patchComponentSFCPortsSource(result.source, { type: 'remove-port', role: 'require', name: 'openDetails' }, options)
    expect(result.ok, result.message).toBe(true)
    result = patchComponentSFCPortsSource(result.source, { type: 'remove-port', role: 'provides', name: 'refresh' }, options)
    expect(result.ok, result.message).toBe(true)
    result = patchComponentSFCPortsSource(result.source, { type: 'remove-port', role: 'emits', name: 'rowActivated' }, options)
    expect(result.ok, result.message).toBe(true)
    result = patchComponentSFCPortsSource(result.source, { type: 'set-forward', declaration: null }, options)

    expect(result.ok).toBe(true)
    expect(result.projection.manifest.require.actions).toEqual([])
    expect(result.projection.manifest.provides.actions).toEqual([])
    expect(result.projection.manifest.emits.events).toEqual([])
    expect(result.projection.manifest.forward.rules).toEqual([])
    expect(result.source).toContain('// этот комментарий не принадлежит definePorts')
    expect(result.source).toContain('const untouched = { value: 1 }')
  })

  it('keeps unsupported constructions in source-only mode', () => {
    const source = `<script setup lang="ts">const ports = definePorts({ emits: { ...shared } })</script>${template}`
    const projection = inspectComponentSFCPortsSource(source)
    const result = patchComponentSFCPortsSource(source, {
      type: 'set-event',
      name: 'opened',
      payloadType: 'void',
    })

    expect(projection.editable).toBe(false)
    expect(result.ok).toBe(false)
    expect(result.source).toBe(source)
  })
})
