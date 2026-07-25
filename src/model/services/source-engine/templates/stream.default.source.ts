export const STREAM_DEFAULT_SOURCE = `defineStream({
  transport: sse({
    url: '/events',
    withCredentials: false,
  }),

  events: {
    message: event('domain.event'),
  },
})
`
