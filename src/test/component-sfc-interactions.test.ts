import { describe, expect, it, vi } from 'vitest'

import { compileComponentSFC } from '@/modules/compiler/services/component-sfc/component-sfc-compile'
import { listComponentSFCEventCapableTags } from '@/modules/domain/types/component/sfc/intrinsic-events.types'
import { createEmptyComponentSFCPortManifest } from '@/modules/domain/types/component/sfc/ports.types'
import { ComponentSFCEventBoundary } from '@/modules/runtime/ComponentSFCEventBoundary'

describe('component SFC :on interactions', () => {
  it('resolves a required Query reaction through the mounted instance binding', async () => {
    const manifest = createEmptyComponentSFCPortManifest()
    manifest.require.queries.push({
      kind: 'query',
      name: 'updateActualTime',
      defaultIdentity: 'groundhandling-update-default',
      inputType: 'UpdateInput',
      outputType: 'void',
      inputs: [],
      outputs: [],
    })
    const calls: string[] = []
    const host = {
      publishEventPort: vi.fn(),
      executeEventPortAction: vi.fn(async (_owner: string, port: any) => {
        calls.push(port.action.identity)
        return true
      }),
      emit: vi.fn(),
    }
    const boundary = new ComponentSFCEventBoundary(
      host as any,
      'groundhandling-process',
      manifest,
      null,
      undefined,
      [],
      undefined,
      [{ port: 'updateActualTime', kind: 'query', identity: 'groundhandling-update-special' }],
    )
    await boundary.routeChild(
      { nodeId: 'actual', componentTag: 'DateTime' },
      'edited',
      { value: '2026-08-21T10:00' },
      [{
        name: 'edited',
        modifiers: [],
        action: {
          kind: 'required-port',
          portKind: 'query',
          port: 'updateActualTime',
          input: { kind: 'event', path: null },
        },
      }],
    )
    expect(calls).toEqual(['groundhandling-update-special'])
  })

  it('compiles ordered reactions and keeps the trigger expression reaction-free', () => {
    const result = compileComponentSFC(`<template>
  <Text
    value="Open"
    :on.stop.prevent="[{
      event: 'click',
      button: 0,
      held: { code: ['KeyW'], exact: true },
      modifiers: { shift: true, exact: true },
      reaction: [
        action({ identity: 'cell.select', input: { rowId: rowId, event: event() } }),
        query({ identity: 'selection.refresh', input: { rowId: rowId } }),
      ],
    }]"
  />
</template>`)

    expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([])
    const root = result.ir?.template?.roots[0]
    if (!root || root.kind !== 'element') {
      throw new Error('Text root was not compiled')
    }
    const rule = root.interactions?.[0]?.rules[0]
    expect(rule).toMatchObject({
      event: 'click',
      modifiers: ['stop', 'prevent'],
      listener: { capture: false, passive: false },
    })
    expect(rule?.reactions).toEqual([
      expect.objectContaining({ kind: 'action', identity: 'cell.select' }),
      expect.objectContaining({ kind: 'query', identity: 'selection.refresh' }),
    ])
    expect(rule?.trigger.kind).toBe('expression')
    if (rule?.trigger.kind === 'expression') {
      expect(rule.trigger.source).not.toContain('reaction')
    }
  })

  it('checks the complete suffix modifier power set and rejects passive + prevent', () => {
    const modifiers = ['stop', 'prevent', 'self', 'once', 'capture', 'passive']
    for (let mask = 0; mask < 2 ** modifiers.length; mask++) {
      const active = modifiers.filter((_modifier, index) => (mask & (1 << index)) !== 0)
      const suffix = active.map(modifier => `.${modifier}`).join('')
      const result = compileComponentSFC(`<template><Text :on${suffix}="{ event: 'click', reaction: action({ identity: 'audit.click' }) }" /></template>`)
      const errors = result.diagnostics.filter(item => item.severity === 'error')
      if (active.includes('passive') && active.includes('prevent')) {
        expect(errors).toEqual(expect.arrayContaining([
          expect.objectContaining({ code: 'sfc-template-on-passive-prevent' }),
        ]))
      }
      else {
        expect(errors).toEqual([])
        const root = result.ir?.template?.roots[0]
        if (!root || root.kind !== 'element') {
          throw new Error('Text root was not compiled')
        }
        expect(root.interactions?.[0]?.rules[0]?.modifiers).toEqual(active)
      }
    }
  })

  it('rejects structural tags and dynamic listener options', () => {
    const structural = compileComponentSFC(`<template><Column :on="{ event: 'click', reaction: action({ identity: 'x' }) }" /></template>`)
    expect(structural.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'sfc-template-on-event-unknown' }),
    ]))

    const dynamic = compileComponentSFC(`<script setup lang="ts">const passive = true</script><template><Text :on="{ event: 'click', passive, reaction: action({ identity: 'x' }) }" /></template>`)
    expect(dynamic.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'sfc-template-on-listener-static' }),
    ]))

    const editable = compileComponentSFC(`<template><Text value="x" editable :edit-on="{ event: 'click', passive: true, prevent: true }" /></template>`)
    expect(editable.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'sfc-edit-on-passive-prevent' }),
    ]))
  })

  it('accepts :on on every renderer-owned event-capable tag', () => {
    for (const tag of listComponentSFCEventCapableTags()) {
      const result = compileComponentSFC(`<template><${tag} :on="{ event: 'click', reaction: action({ identity: 'audit.click' }) }" /></template>`)
      expect(result.diagnostics.filter(item => item.code.startsWith('sfc-template-on'))).toEqual([])
      const root = result.ir?.template?.roots[0]
      if (!root || root.kind !== 'element') {
        throw new Error(`${tag} root was not compiled`)
      }
      expect(root.interactions?.[0]?.rules[0]?.event).toBe('click')
    }
  })

  it('compiles a context-backed TriggerSet with one shared Query reaction', () => {
    const result = compileComponentSFC(`<template>
  <Cell :on="{
    triggers: $context.config.groundHandling.actualTimeTriggers,
    reaction: query({
      identity: 'groundHandling.actualTime.update',
      input: {
        legId: row.arrivalLeg.id,
        station: row.arrivalLeg.latestArrivalStationIataCode,
        code: 'Bridge On',
        point: 'value',
        value: now(),
        comment: null,
      },
    }),
  }"><Text value="Bridge" /></Cell>
</template>`)

    expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([])
    const root = result.ir?.template?.roots[0]
    if (!root || root.kind !== 'element') {
      throw new Error('Cell root was not compiled')
    }
    const group = root.interactions?.[0]
    expect(group?.rules).toEqual([])
    expect(group?.triggerSet?.events).toEqual(expect.arrayContaining(['contextmenu', 'keydown']))
    expect(group?.triggerSet?.triggers).toMatchObject({
      kind: 'expression',
      source: '$context.config.groundHandling.actualTimeTriggers',
    })
    expect(group?.triggerSet?.reactions).toEqual([
      expect.objectContaining({
        kind: 'query',
        identity: 'groundHandling.actualTime.update',
        input: expect.objectContaining({
          kind: 'object',
          entries: expect.arrayContaining([
            { key: 'value', value: { kind: 'now' } },
          ]),
        }),
      }),
    ])
    expect(result.dependencies.queries).toContain('groundHandling.actualTime.update')
  })

  it('executes a reaction list sequentially and stops after a failed reaction', async () => {
    const calls: string[] = []
    const host = {
      publishEventPort: vi.fn(),
      executeEventPortAction: vi.fn(async (_owner: string, port: any) => {
        calls.push(port.action.identity)
        return port.action.identity !== 'second'
      }),
      emit: vi.fn(),
    }
    const boundary = new ComponentSFCEventBoundary(host as any, 'test', createEmptyComponentSFCPortManifest())
    await boundary.routeChild(
      { nodeId: 'node', componentTag: 'Text' },
      'click',
      { type: 'click' },
      [{
        name: 'click',
        modifiers: [],
        action: { kind: 'action', identity: 'first' },
        actions: [
          { kind: 'action', identity: 'first' },
          { kind: 'action', identity: 'second' },
          { kind: 'action', identity: 'third' },
        ],
      }],
    )
    expect(calls).toEqual(['first', 'second'])
  })
})
