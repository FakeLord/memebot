import type { DesktopApi } from '../shared/types'

declare global {
  interface Window {
    // Sadece masaüstü uygulamasında var; tarayıcıda undefined
    desktop?: DesktopApi
  }
}

export {}
