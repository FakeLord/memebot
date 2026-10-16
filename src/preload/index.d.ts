import type { MemeBotApi } from '../shared/types'

declare global {
  interface Window {
    api: MemeBotApi
  }
}

export {}
