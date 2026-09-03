/** Секция source, которую пользователь видит как вкладку script. */
export interface RComponentSFCSource_Script {
  /** Содержимое <script setup>. */
  content: string
}

/** Секция source, которую пользователь видит как вкладку template. */
export interface RComponentSFCSource_Template {
  /** Содержимое <template>. */
  content: string
}

/** Секция source, которую пользователь видит как вкладку style. */
export interface RComponentSFCSource_Style {
  /** Содержимое <style>. */
  content: string

  /** Флаг scoped-стилей в духе Vue/Nova SFC. */
  scoped: boolean
}

/** Разложенное представление SFC для вкладок конфигуратора. */
export interface RComponentSFCSource_Parts {
  /** Script-секция компонента. */
  script: RComponentSFCSource_Script

  /** Template-секция компонента. */
  template: RComponentSFCSource_Template

  /** Style-секция компонента. */
  style: RComponentSFCSource_Style
}
