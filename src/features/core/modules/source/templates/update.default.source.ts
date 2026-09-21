export const UPDATE_DEFAULT_SOURCE = `defineUpdate({
  handles: [],
  mutations: [
    {
      strategy: 'merge',
      target: 'items[id=$id]',
      ifExists: null,
      valueFrom: '',
      vars: {
        id: 'id',
      },
    },
  ],
})
`
