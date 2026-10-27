import type { EndgeUIJsonMount, EndgeUINode, EndgeUIPatch } from '@/features/core/modules/ui/domain/types/endge-ui-json.types'

/**
 * Пример host-а JSON UI `endge-ui/v1` без фреймворка: строит DOM из снимка,
 * применяет патчи по id узлов и передаёт события в `dispatch`.
 * В браузере передаётся настоящий `document`; тест использует минимальную подделку.
 */

// Подмножество DOM API, которое использует пример.
export interface EndgeUIDomNode {
  textContent: string | null
  replaceWith: (...nodes: EndgeUIDomNode[]) => void
}

export interface EndgeUIDomElement extends EndgeUIDomNode {
  setAttribute: (name: string, value: string) => void
  replaceChildren: (...nodes: EndgeUIDomNode[]) => void
  addEventListener: (type: string, listener: (event: unknown) => void) => void
  style: { setProperty: (name: string, value: string) => void }
}

export interface EndgeUIDomDocument {
  createElement: (tag: string) => EndgeUIDomElement
  createTextNode: (text: string) => EndgeUIDomNode
}

const TAGS: Record<string, string> = {
  'Flex': 'div',
  'Box': 'div',
  'Grid': 'div',
  'Divider': 'hr',
  'Input': 'input',
  'Textarea': 'textarea',
  'Checkbox': 'input',
  'Select': 'select',
  'Table': 'table',
  '#row': 'tr',
  '#cell': 'td',
  'DateTime': 'time',
}

export interface EndgeUIDomHost {
  readonly root: EndgeUIDomElement
  destroy: () => void
}

export function createEndgeUIDomHost(document: EndgeUIDomDocument, mount: EndgeUIJsonMount): EndgeUIDomHost {
  const root = document.createElement('div')
  const elements = new Map<string, EndgeUIDomNode>()
  const nodes = new Map<string, EndgeUINode>()

  const build = (node: EndgeUINode): EndgeUIDomNode => {
    nodes.set(node.id, node)
    if (node.type === '#text') {
      const text = document.createTextNode(node.text ?? '')
      elements.set(node.id, text)
      return text
    }
    const element = document.createElement(TAGS[node.type] ?? 'span')
    element.setAttribute('data-endge-id', node.id)
    element.setAttribute('data-endge-type', node.type)
    if (node.classes?.length) {
      element.setAttribute('class', node.classes.join(' '))
    }
    if (node.type === 'Flex') {
      element.style.setProperty('display', 'flex')
      element.style.setProperty('flex-direction', node.props.col ? 'column' : 'row')
    }
    for (const [property, value] of Object.entries(node.style ?? {})) {
      element.style.setProperty(property, value)
    }
    for (const event of node.events ?? []) {
      element.addEventListener(event, (domEvent) => {
        const target = (domEvent as { target?: { value?: unknown } } | null)?.target
        void mount.dispatch(node.id, event, target && 'value' in target ? { value: target.value } : {})
      })
    }
    if (node.children.length) {
      element.replaceChildren(...node.children.map(build))
    }
    else if (node.text !== undefined) {
      element.textContent = node.text
    }
    elements.set(node.id, element)
    return element
  }

  const rebuild = (id: string): void => {
    const node = nodes.get(id)
    const current = elements.get(id)
    if (node && current) {
      current.replaceWith(build(node))
    }
  }

  const apply = (patch: EndgeUIPatch): void => {
    for (const op of patch.ops) {
      if (op.op === 'update') {
        const node = nodes.get(op.id)
        if (!node) {
          continue
        }
        for (const field of op.unset ?? []) {
          delete (node as Partial<EndgeUINode>)[field]
        }
        Object.assign(node, op.set)
        rebuild(op.id)
      }
      else if (op.op === 'replace') {
        const current = elements.get(op.id)
        current?.replaceWith(build(op.node))
      }
      else if (op.op === 'children') {
        const children = op.children.map(entry => 'ref' in entry && !('type' in entry) ? nodes.get(entry.ref)! : entry as EndgeUINode)
        const parent = op.id === null ? root : elements.get(op.id) as EndgeUIDomElement | undefined
        if (op.id !== null) {
          nodes.get(op.id)!.children = children
        }
        parent?.replaceChildren(...children.map(child => elements.get(child.id) ?? build(child)))
      }
    }
  }

  root.replaceChildren(...mount.snapshot().roots.map(build))
  const unsubscribe = mount.subscribe(apply)
  return {
    root,
    destroy: () => {
      unsubscribe()
      elements.clear()
      nodes.clear()
    },
  }
}
