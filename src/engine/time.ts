// "Bugün" kullanıcının saat diliminde başlar (varsayılan İstanbul), motorun çalıştığı makinenin
// saat diliminde değil: VPS UTC'de çalışsa da günlük limitler gece yarısı (TR) sıfırlanır.

export function startOfDay(timeZone: string, now = new Date()): Date {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value])
  )
  // O saat dilimindeki duvar saatini UTC sanıp farkı bul → gece yarısını geri hesapla
  const wallAsUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second)
  const offset = wallAsUtc - Math.floor(now.getTime() / 1000) * 1000
  const midnightWall = Date.UTC(+parts.year, +parts.month - 1, +parts.day)
  return new Date(midnightWall - offset)
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
