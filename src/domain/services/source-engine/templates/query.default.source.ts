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

  outputs: {
    raw: output()
      .from(response('items'))
      .toStore(),
  },

  mock: {
    enabled: false,
    data: null,
  },
})
`
