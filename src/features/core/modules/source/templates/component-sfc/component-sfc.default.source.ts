/** Канонический source нового SFC-компонента. */
export const COMPONENT_SFC_DEFAULT_SOURCE = `<script setup lang="ts">
const props = defineProps<Record<string, unknown>>()
</script>

<template>
  <Text>{{ props.label ?? 'SFC' }}</Text>
</template>

<style lang="endgecss" scoped>
</style>
`
