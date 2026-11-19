import { getCloudflareContext } from '@opennextjs/cloudflare'

export function env() {
  return getCloudflareContext().env
}
