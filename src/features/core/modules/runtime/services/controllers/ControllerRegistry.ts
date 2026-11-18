import type { ControllerDefinition, ControllerProvider } from '../../domain/controllers/controller.types'
import { copyBundleJson } from '@/features/core/kernel/tools/bundle-json'

/** Definitions are serializable; provider factories remain local executable code. */
export class ControllerRegistry {
  private readonly _active = new Map<string, number>()
  private readonly _definitions = new Map<string, ControllerDefinition>()
  private readonly _providers = new Map<string, ControllerProvider>()
  public define(definition: ControllerDefinition): () => void {
    if (!definition.identity.trim() || this._definitions.has(definition.identity)) {
      throw new Error(`controller-definition-collision: ${definition.identity}`)
    }
    const value = copyBundleJson(definition) as unknown as ControllerDefinition
    if (!value.defaultProviderKey?.trim() || !value.displayName?.trim() || !value.origin) {
      throw new Error('controller-definition-invalid')
    }
    for (
      const fields of [value.contract.props, value.contract.outputs]) {
      if (fields.some(field => !/^[A-Z_$][\w$]*$/i.test(field.key))) {
        throw new Error('controller-field-key-invalid')
      }
      if (new Set(fields.map(field => field.key)).size !== fields.length) {
        throw new Error('controller-contract-duplicate-field')
      }
    }
    for (
      const key of [...Object.keys(value.contract.commands), ...Object.keys(value.contract.dependencies)]) {
      if (!/^[A-Z_$][\w$]*$/i.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) {
        throw new Error('controller-contract-key-invalid')
      }
    }
    this._definitions.set(value.identity, value)
    return () => {
      if (this._active.get(value.identity)) {
        throw new Error('controller-definition-in-use')
      }
      this._definitions.delete(value.identity)
    }
  }

  public provide(provider: ControllerProvider): () => void {
    if (!this._definitions.has(provider.identity) || this._providers.has(provider.key)) {
      throw new Error(`controller-provider-collision-or-missing-definition: ${provider.identity}`)
    }
    this._providers.set(provider.key, Object.freeze({
      ...provider,
    }))
    return () => {
      if (this._active.get(provider.identity)) {
        throw new Error('controller-provider-in-use')
      }
      this._providers.delete(provider.key)
    }
  }

  public get(identity: string): ControllerDefinition | null {
    const definition = this._definitions.get(identity)
    return definition ? JSON.parse(JSON.stringify(definition)) : null
  }

  public provider(definition: ControllerDefinition): ControllerProvider {
    const provider = this._providers.get(definition.defaultProviderKey)
    if (!provider || provider.identity !== definition.identity) {
      throw new Error(`controller-provider-missing: ${definition.identity}`)
    }
    return provider
  }

  public acquire(definition: ControllerDefinition): {
    provider: ControllerProvider
    release: () => void
  } {
    const provider = this.provider(definition)
    this._active.set(definition.identity, (this._active.get(definition.identity) ?? 0) + 1)
    let released = false
    return {
      provider,
      release: () => {
        if (released) {
          return
        }
        released = true
        const count = (this._active.get(definition.identity) ?? 1) - 1
        if (count) {
          this._active.set(definition.identity, count)
        }
        else {
          this._active.delete(definition.identity)
        }
      },
    }
  }

  public list(): ControllerDefinition[] {
    return [...this._definitions.keys()].map(identity => this.get(identity)!)
  }
}
