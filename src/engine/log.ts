// Motor günlüğü: standart çıktıya tek satır. Masaüstünde ana süreç bu satırları toplar, VPS'te systemd/journal.
// Sırlar (anahtar, oturum, kod) ASLA günlüğe yazılmaz; sadece kimlik ve durum.

export type LogLevel = 'info' | 'warn' | 'error'

export interface Logger {
  info(msg: string, extra?: Record<string, unknown>): void
  warn(msg: string, extra?: Record<string, unknown>): void
  error(msg: string, extra?: Record<string, unknown>): void
}

export function createLogger(write: (line: string) => void = (l) => process.stdout.write(l + '\n')): Logger {
  const out = (level: LogLevel, msg: string, extra?: Record<string, unknown>) => {
    const ts = new Date().toISOString()
    write(`${ts} ${level.toUpperCase().padEnd(5)} ${msg}${extra ? ' ' + JSON.stringify(extra) : ''}`)
  }
  return {
    info: (m, e) => out('info', m, e),
    warn: (m, e) => out('warn', m, e),
    error: (m, e) => out('error', m, e)
  }
}

export const silentLogger: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined }
