/** Базовый source для новой RQuery v1. */
export const QUERY_DEFAULT_SOURCE = `defineQuery({
  kind: 'rest',

  request: {
    endpoint: '',
    path: '',
    method: 'GET',
    headers: {},
    auth: {
      mode: 'token',
    },
  },

  params: {},

  filters: {
    mode: 'merge',
    items: [],
  },

  response: {
    subField: 'items',
    return: null,
  },

  mock: {
    enabled: false,
    data: null,
  },
})
`
