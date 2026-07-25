export const UPDATE_DEFAULT_SOURCE = `defineUpdate({
  handles: null,
  strategy: 'merge',
  target: 'items[id=$key]',
  keyFrom: 'id',
  valueFrom: '',
})
`
