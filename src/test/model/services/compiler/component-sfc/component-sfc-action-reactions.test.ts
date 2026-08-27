import { describe, expect, it } from 'vitest'

import { compileComponentSFC } from '@/model/services/compiler/component-sfc/component-sfc-compile'

describe('component SFC Action reactions', () => {
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
    if (!root || root.kind !== 'element') {
      throw new Error('Text root was not compiled')
    }
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
    if (!root || root.kind !== 'element') {
      throw new Error('Text root was not compiled')
    }
    expect(root.events?.[0]?.actions?.map(action => 'identity' in action ? action.identity : null)).toEqual(['first', 'second'])
  })

  it('compiles an inline Operation with implicit input and shorthand blocks', () => {
    const result = compileComponentSFC(`<template><Text value="OLD" editable @edited="operation({
      run: query({ identity: 'schedule-update', input: { id: rowKey, value: input('value') } }),
      undo: query({ identity: 'schedule-update', input: { id: rowKey, value: input('previousValue') } }),
    })" /></template>`)
    expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([])
    const root = result.ir?.template?.roots[0]
    if (!root || root.kind !== 'element') {
      throw new Error('Text root was not compiled')
    }
    expect(root.events?.[0]?.action).toMatchObject({
      kind: 'operation',
      run: { output: null, steps: [{ name: 'default', action: { kind: 'query', identity: 'schedule-update' } }] },
      undo: { output: null, steps: [{ name: 'default', action: { kind: 'query', identity: 'schedule-update' } }] },
      redo: null,
    })
    expect(JSON.stringify(root.events?.[0]?.action)).toContain('"kind":"operation-input"')
    expect(result.dependencies.queries).toContain('schedule-update')
  })

  it('compiles explicit operation input and an optional full-block output', () => {
    const result = compileComponentSFC(`<template><Text value="OLD" editable @edited="operation({
      input: { id: rowKey, value: event('value'), previousValue: event('previousValue') },
      run: { steps: { request: query({ identity: 'schedule-update', input: { id: input('id'), value: input('value') } }) }, output: output('request') },
      undo: { steps: { request: query({ identity: 'schedule-update', input: { id: input('id'), value: input('previousValue') } }) } },
      redo: query({ identity: 'schedule-update', input: { id: input('id'), value: input('value') } }),
    })" /></template>`)
    expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([])
    const root = result.ir?.template?.roots[0]
    if (!root || root.kind !== 'element') {
      throw new Error('Text root was not compiled')
    }
    expect(root.events?.[0]?.action).toMatchObject({
      kind: 'operation',
      run: { output: 'request' },
      redo: { steps: [{ name: 'default', action: { kind: 'query', identity: 'schedule-update' } }] },
    })
  })
})
