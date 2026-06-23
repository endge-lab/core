/**
 * Глобальный JSX-контекст для скриптов DSL
 */

declare const $: Record<string, any>

declare namespace JSX {
  interface IntrinsicElements {
    Text: {
      children?: any
      bold?: boolean
      italic?: boolean
      underline?: boolean
      strike?: boolean
      color?: string
      bg?: string
      size?: string | number
      align?: string
      weight?: string
      shadow?: string
      uppercase?: boolean
      lowercase?: boolean
      capitalize?: boolean
      class?: string
    }

    Layout: {
      children?: any
      direction?: 'row' | 'column'
      gap?: string | number
      align?: string
      justify?: string
      wrap?: boolean | string
      class?: string
    }

    Icon: {
      name: string
      size?: string | number
      color?: string
      class?: string
    }

    Button: {
      children?: any
      variant?: 'solid' | 'outline' | 'ghost'
      color?: string
      onClick?: () => void
      class?: string
    }

    Box: {
      children?: any
      padding?: string
      margin?: string
      shadow?: string
      border?: string
      rounded?: boolean
      bg?: string
      class?: string
    }

    Spacer: {
      size?: string | number
    }

    Image: {
      src: string
      alt?: string
      width?: string | number
      height?: string | number
      rounded?: boolean
      class?: string
    }
  }
}
