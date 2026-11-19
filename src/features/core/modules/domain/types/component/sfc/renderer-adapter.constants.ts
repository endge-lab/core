// Канонический ID встроенного Vue SFC-адаптера.
export const ENDGE_VUE_SFC_ADAPTER_ID = 'vue'

export function normalizeVueSfcAdapterId(id: string): string {
  return id === 'vue-native' || id === 'native-vue' ? ENDGE_VUE_SFC_ADAPTER_ID : id
}
