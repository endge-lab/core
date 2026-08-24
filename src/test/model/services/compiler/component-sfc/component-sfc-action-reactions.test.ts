import { describe, expect, it } from 'vitest'

import { compileComponentSFC } from '@/model/services/compiler/component-sfc/component-sfc-compile'

describe('Component SFC Action reactions', () => {
  it('keeps edited value and previousValue in one Action reaction', () => {
    const result = compileComponentSFC(`<template>
      <Text value="OLD" editable @edited.stop="action({
        identity: 'schedule-edit-flight-carrier',
        input: {
          value: event('value'),
          previousValue: event('previousValue'),
        },
      })" />
    </template>`)
    expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([])
    const root = result.ir?.template?.roots[0]
    if (!root || root.kind !== 'element') throw new Error('Text root was not compiled')
    expect(root.events?.[0]).toMatchObject({
      name: 'edited',
      modifiers: ['stop'],
      action: {
        kind: 'action',
        identity: 'schedule-edit-flight-carrier',
      },
    })
    const input = JSON.stringify((root.events?.[0]?.action as any)?.input)
    expect(input).toContain('"path":"value"')
    expect(input).toContain('"path":"previousValue"')
  })

  it('preserves the source order of an Action reaction array', () => {
    const result = compileComponentSFC(`<template><Text value="OLD" editable @edited="[
      action({ identity: 'first', input: event() }),
      action({ identity: 'second', input: event() }),
    ]" /></template>`)
    expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([])
    const root = result.ir?.template?.roots[0]
    if (!root || root.kind !== 'element') throw new Error('Text root was not compiled')
    expect(root.events?.[0]?.actions?.map(action => 'identity' in action ? action.identity : null)).toEqual(['first', 'second'])
  })

  it('does not expose Operation DSL inline', () => {
    const result = compileComponentSFC(`<template><Text editable @edited="operation({ input: {}, run: {}, undo: {} })" /></template>`)
    expect(result.diagnostics.some(item => item.severity === 'error')).toBe(true)
  })
})
