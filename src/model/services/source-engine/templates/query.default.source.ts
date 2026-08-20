/** Базовый canonical source для новой RQuery v2. */
export const QUERY_DEFAULT_SOURCE = `defineQuery({
  kind: 'rest',

  props: defineProps({
    filterPayload: field('Object').optional(),
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
      .from(response('items')),
  },

  mock: {
    enabled: false,
    data: null,
  },
})
`

/** Базовый canonical source для новой GraphQL RQuery v2. */
export const QUERY_GRAPHQL_DEFAULT_SOURCE = `defineQuery({
  kind: 'graphql',

  props: defineProps({
    id: field('String'),
  }),

  request: {
    endpoint: '',
    operationName: 'LoadItem',
    document: gql\`
      query LoadItem($id: ID!) {
        item(id: $id) {
          id
        }
      }
    \`,
    variables: variables(({ prop }) => ({
      id: prop('id'),
    })),
    headers: {},
    auth: {
      mode: 'inherit',
    },
    errorPolicy: 'throw',
  },

  outputs: {
    item: output()
      .from(data('item')),
  },

  mock: {
    enabled: false,
    data: null,
  },
})
`
