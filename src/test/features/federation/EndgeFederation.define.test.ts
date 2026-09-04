import type { EndgeModuleDefinition } from '@/features/federation/types/endge-modules.types'
import { describe, expect, it, vi } from 'vitest'
import { EndgeFederation } from '@/features/federation/EndgeFederation'
import { EndgeModule } from '@/features/federation/EndgeModule'

class DependencyModule extends EndgeModule {}

class ConsumerModule extends EndgeModule {
  public constructor(public readonly dependency: DependencyModule) {
    super()
  }
}

describe('endgeFederation.define', () => {
  it('лениво создаёт модули один раз и публикует типизированные accessors', () => {
    const createDependency = vi.fn(() => new DependencyModule())
    const definitions = [
      {
        key: 'dependency',
        create: createDependency,
      },
      {
        key: 'consumer',
        create: ({ getModule }) => new ConsumerModule(
          getModule<DependencyModule>('dependency'),
        ),
        after: 'dependency',
      },
    ] as const satisfies readonly EndgeModuleDefinition[]

    const TestFederation = EndgeFederation.define({
      id: 'test-define-accessors',
      modules: definitions,
    })

    expect(createDependency).not.toHaveBeenCalled()
    expect(TestFederation.consumer.dependency).toBe(TestFederation.dependency)
    expect(TestFederation.dependency).toBe(TestFederation.getModule('dependency'))
    expect(createDependency).toHaveBeenCalledTimes(1)
  })

  it('сохраняет generated accessors при наследовании custom federation', () => {
    const GeneratedFederation = EndgeFederation.define({
      id: 'test-define-extension',
      modules: [
        {
          key: 'dependency',
          create: () => new DependencyModule(),
        },
      ] as const satisfies readonly EndgeModuleDefinition[],
    })

    class CustomFederation extends GeneratedFederation {
      public static get customDependency(): DependencyModule {
        return this.dependency
      }
    }

    expect(CustomFederation.customDependency).toBe(CustomFederation.dependency)
  })

  it('отклоняет module key, конфликтующий с API федерации', () => {
    expect(() => EndgeFederation.define({
      id: 'test-define-conflict',
      modules: [
        {
          key: 'boot',
          create: () => new DependencyModule(),
        },
      ] as const satisfies readonly EndgeModuleDefinition[],
    })).toThrow('module key "boot" conflicts with federation API')
  })

  it('обнаруживает цикл между module factories', () => {
    const TestFederation = EndgeFederation.define({
      id: 'test-define-cycle',
      modules: [
        {
          key: 'first',
          create: ({ getModule }) => getModule<DependencyModule>('second'),
        },
        {
          key: 'second',
          create: ({ getModule }) => getModule<DependencyModule>('first'),
        },
      ] as const satisfies readonly EndgeModuleDefinition[],
    })

    expect(() => TestFederation.first).toThrow('circular module factory dependency: first -> second -> first')
  })
})
