export const STREAM_DEFAULT_SOURCE = `defineStream({
  transport: sse({
    url: env('ENDPOINT_SSE'),
    withCredentials: false,
    auth: 'inherit',
  }),

  events: {
    message: event({
      typeFrom: 'eventInfo.name',
      payloadFrom: '',
    }),
  },
})
`
