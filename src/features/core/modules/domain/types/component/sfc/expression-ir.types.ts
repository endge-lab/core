// Исполняемые SFC expressions. Не содержат parser AST или исходного синтаксиса.
export type ComponentSFCExpressionIR
  = | { kind: 'literal', value: string | number | boolean | null }
    | { kind: 'read', name: string }
    | { kind: 'unary', operator: string, argument: ComponentSFCExpressionIR }
    | { kind: 'binary' | 'logical', operator: string, left: ComponentSFCExpressionIR, right: ComponentSFCExpressionIR }
    | { kind: 'conditional', test: ComponentSFCExpressionIR, consequent: ComponentSFCExpressionIR, alternate: ComponentSFCExpressionIR }
    | { kind: 'member', object: ComponentSFCExpressionIR, property: ComponentSFCExpressionIR, computed: boolean }
    | { kind: 'select', object: ComponentSFCExpressionIR, key: string, value: ComponentSFCExpressionIR }
    | { kind: 'call', callee: ComponentSFCExpressionIR, arguments: ComponentSFCExpressionIR[] }
    | { kind: 'array', items: ComponentSFCExpressionIR[] }
    | { kind: 'object', entries: Array<{ key: string, value: ComponentSFCExpressionIR }> }
    | { kind: 'template', parts: string[], expressions: ComponentSFCExpressionIR[] }
    | { kind: 'unsupported', reason?: 'object-property' }
