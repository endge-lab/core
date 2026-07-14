export type TimeZoneMode = 'LT' | 'UTC'

export interface EndgeUISnapshot {

  //
  // ZOOM
  zoom: number
  zoomClass: string

  //
  // THEME
  theme: string
  isDark: boolean

  //
  // TIME
  isLocalTime: boolean
  timeZone: TimeZoneMode
}

export const THEME_CLASS_BY_NAME: Record<string, string[]> = {
  light: ['v-theme--light'],
  dark: ['v-theme--dark', 'dark'], // важно: dark для shadcn variables
  light_calm: ['v-theme--light_calm'],
}

export interface ThemeConfig {
  defaultTheme: string
  availableThemes: string[]
  storageKey: string
}

export const themeConfig: ThemeConfig = {
  defaultTheme: 'light',
  availableThemes: ['light', 'dark', 'light_calm'],
  storageKey: 'endge:theme',
}

export const ALL_THEME_CLASSES: string[] = Array.from(
  new Set(Object.values(THEME_CLASS_BY_NAME).flat()),
)
