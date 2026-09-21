import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { Endge } from '@/features/core/kernel/endge'
import { RComponentSFC } from '@/features/core/modules/domain/entities/RComponentSFC'
import { prepareTestCompilerContext, resetTestCompilerContext } from '@/test/helpers/compiler-context'

describe('реестр тегов компонентов EndgeCompiler', () => {
  beforeEach(() => prepareTestCompilerContext())

  afterEach(() => {
    resetTestCompilerContext()
  })

  it('регистрирует простые теги и теги с точкой до компиляции templates', () => {
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

  it('сообщает о дублирующихся тегах у каждого owner и не регистрирует неоднозначный тег', () => {
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

  it('сохраняет имена встроенных примитивов зарезервированными', () => {
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
