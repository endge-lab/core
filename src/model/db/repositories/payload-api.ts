import axios, { type AxiosInstance } from 'axios'

export interface PayloadClientConfig {
  baseUrl: string
  secret: string
}

/**
 * Чистый фабричный клиент Payload.
 * Никаких Endge.vars, только переданные параметры.
 */
export function createPayloadClient(
  config: PayloadClientConfig,
): AxiosInstance {
  const { baseUrl, secret } = config

  if (!baseUrl || !secret) {
    throw new Error('Missing baseUrl or secret for Payload client')
  }

  return axios.create({
    baseURL: baseUrl.replace(/\/+$/, ''), // на всякий - срезаем хвостовые /
    headers: {
      Authorization: `Bearer ${secret}`,
    },
  })
}
