/** Базовый canonical source для новой RQuery v2. */
export const QUERY_DEFAULT_SOURCE = `defineQuery({
  kind: 'rest',

  props: defineProps({
    filterPayload: field('Object').optional(),
    rowsStoreKey: field('String').default('queries.query.rows'),
  }),

  request: {
    endpoint: '',
    path: '/search',
    method: 'POST',
    headers: {},
    auth: {
      mode: 'inherit',
    },
    body: body(({ prop }) =>
      merge(
        { limit: 100 },
        prop('filterPayload'),
      ),
    ),
  },

  outputs: {
    raw: output()
      .from(response('items'))
      .toStore(prop('rowsStoreKey')),
  },

  mock: {
    enabled: false,
    data: null,
  },
})
`
