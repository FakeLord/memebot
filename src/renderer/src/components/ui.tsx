import type { ComponentType, ReactNode } from 'react'

// Ayar sayfalarının ortak parçaları: bölüm başlığı, ayar satırı, aç/kapa, birimli sayı girişi, durum hapı, istatistik kutusu.

export function Section({
  icon: Icon,
  title,
  count,
  actions,
  note,
  children
}: {
  icon?: ComponentType<{ size?: number }>
  title: string
  count?: number | string
  actions?: ReactNode
  note?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="section">
      <div className="section-head">
        <div className="section-label">
          {Icon && <Icon size={12} />} {title} {count !== undefined && <span className="faint">{count}</span>}
        </div>
        {actions && <div className="section-actions">{actions}</div>}
      </div>
      {children}
      {note && <p className="section-note">{note}</p>}
    </section>
  )
}

export function SettingRow({
  title,
  desc,
  children,
  stacked,
  danger
}: {
  title: ReactNode
  desc?: ReactNode
  children?: ReactNode
  stacked?: boolean
  danger?: boolean
}) {
  return (
    <div className={`setting-row${stacked ? ' stacked' : ''}${danger ? ' danger' : ''}`}>
      <div className="setting-row-text">
        <span className="setting-row-title">{title}</span>
        {desc && <span className="setting-row-desc">{desc}</span>}
      </div>
      {children && <div className="setting-row-control">{children}</div>}
    </div>
  )
}

export function Toggle({ checked, onChange, disabled, title }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; title?: string }) {
  return <button type="button" role="switch" className="toggle" aria-checked={checked} disabled={disabled} title={title} onClick={() => onChange(!checked)} />
}

/** Sağa yaslı sayı girişi + birim (SOL, %, dk…). Yazarken serbest, alandan çıkınca sayıya çevrilir. */
export function UnitInput({
  value,
  onChange,
  unit,
  min = 0,
  max,
  integer,
  placeholder,
  disabled
}: {
  value: number | string | undefined
  onChange: (v: number) => void
  unit?: string
  min?: number
  max?: number
  integer?: boolean
  placeholder?: string
  disabled?: boolean
}) {
  return (
    <span className="unit-input">
      <input
        inputMode="decimal"
        disabled={disabled}
        placeholder={placeholder}
        defaultValue={value ?? ''}
        key={String(value)}
        onBlur={(e) => {
          let n = Number(e.target.value.replace(',', '.'))
          if (!Number.isFinite(n)) n = min
          n = Math.max(min, max !== undefined ? Math.min(max, n) : n)
          if (integer) n = Math.round(n)
          if (n !== Number(value)) onChange(n)
          else e.target.value = String(value ?? '')
        }}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      {unit && <span>{unit}</span>}
    </span>
  )
}

export function StatusPill({ tone, children }: { tone?: 'on' | 'off' | 'wait'; children: ReactNode }) {
  return (
    <span className={`status-pill ${tone ?? ''}`}>
      {tone && <span className={`dot ${tone}`} style={{ width: 6, height: 6, boxShadow: 'none' }} />}
      {children}
    </span>
  )
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: 'pos' | 'neg' | 'warn' }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className={`stat-value ${tone ?? ''}`}>{value}</span>
    </div>
  )
}

/** "12 sn önce" / "3 dk önce" */
export function since(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—'
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (s < 60) return `${s} sn önce`
  if (s < 3600) return `${Math.floor(s / 60)} dk önce`
  if (s < 86400) return `${Math.floor(s / 3600)} sa önce`
  return `${Math.floor(s / 86400)} gün önce`
}
