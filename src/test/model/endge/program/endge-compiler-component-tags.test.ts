import { afterEach, describe, expect, it } from 'vitest'

import { RComponentSFC } from '@/domain/entities/reflect/RComponentSFC'
import { Endge } from '@/model/endge/kernel/endge'

describe('EndgeCompiler component tag registry', () => {
  afterEach(() => {
    Endge.program.clear()
    Endge.domain.reset()
  })

  it('registers simple and dotted tags before compiling templates', () => {
    const tail = createComponent(1, 'aircraft-tail', 'Tail', '<Text>Tail</Text>')
    const type = createComponent(2, 'aircraft-type', 'Module.SomeTag', '<Text>Type</Text>')
    const consumer = createComponent(3, 'aircraft-cell', null, '<Tail /><Module.SomeTag />')
    Endge.domain.addComponentSFC(tail)
    Endge.domain.addComponentSFC(type)
    Endge.domain.addComponentSFC(consumer)

    Endge.compiler.build({} as any)

    expect(Endge.program.resolveComponentTag('Tail')).toBe('aircraft-tail')
    expect(Endge.program.resolveComponentTag('Module.SomeTag')).toBe('aircraft-type')
    expect(Endge.program.getArtifact('component-sfc', 'aircraft-cell')?.status).not.toBe('error')
  })

  it('reports duplicate tags on every owner and does not register an ambiguous tag', () => {
    Endge.domain.addComponentSFC(createComponent(1, 'first-tail', 'Tail', '<Text>First</Text>'))
    Endge.domain.addComponentSFC(createComponent(2, 'second-tail', 'Tail', '<Text>Second</Text>'))

    Endge.compiler.build({} as any)

    expect(Endge.program.resolveComponentTag('Tail')).toBeNull()
    for (const identity of ['first-tail', 'second-tail']) {
      expect(Endge.program.getArtifact('component-sfc', identity)?.diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'component-sfc-tag-duplicate', severity: 'error' }),
      ]))
    }
  })

  it('keeps built-in primitive names reserved', () => {
    Endge.domain.addComponentSFC(createComponent(1, 'custom-text', 'Text', '<Text>Custom</Text>'))

    Endge.compiler.build({} as any)

    expect(Endge.program.resolveComponentTag('Text')).toBeNull()
    expect(Endge.program.getArtifact('component-sfc', 'custom-text')?.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'component-sfc-tag-reserved', severity: 'error' }),
    ]))
  })
})

function createComponent(
  id: number,
  identity: string,
  tag: string | null,
  template: string,
): RComponentSFC {
  const component = new RComponentSFC()
  component.id = id
  component.identity = identity
  component.name = identity
  component.displayName = identity
  component.tag = tag
  component.source = `<template>${template}</template>`
  return component
}
