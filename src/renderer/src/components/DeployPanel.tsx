import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { canTrade, useAuth } from '../lib/auth'
import { errText, useEngine } from '../lib/engine'
import { usePipeline } from '../lib/pipeline'
import { usePrefs } from '../lib/prefs'
import { useKillSwitch } from '../lib/killswitch'
import {
  IMAGE_MAX_BYTES,
  NAME_MAX,
  PLATFORM_LABEL,
  SYMBOL_MAX,
  nameSuggestions,
  symbolFor,
  validateDeploy,
  type AutoSell,
  type DeployForm,
  type DeployPlatform,
  type FeeShare
} from '../../../shared/deploy'
import type { FeedItem } from '../../../shared/feed'
import { shortAddr, useWallets } from '../lib/wallets'
import { SolMark } from '../pages/settings/Wallets'
import { Plus, Split, Timer, Trash2, Upload, Wallet as WalletIcon, X, Zap } from 'lucide-react'

// Token deploy formu (modal ya da yan panel — Ayarlar → Deploy). Gönderiden otomatik doldurur.
// Deneme modunda (Kurallar → Gerçek işlem kapalı) motor isteği sadece hazırlar ve kaydeder; GMGN'e gitmez.

type Snapshot = () => Promise<string | null> // kartın ekran görüntüsü (data URL)

interface DeployCtx {
  open: (item?: FeedItem, snapshot?: Snapshot) => void
}

const Ctx = createContext<DeployCtx>({ open: () => undefined })
export const useDeploy = () => useContext(Ctx)

export function DeployProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ item?: FeedItem; snapshot?: Snapshot; n: number } | null>(null)
  const open = useCallback((item?: FeedItem, snapshot?: Snapshot) => setState((s) => ({ item, snapshot, n: (s?.n ?? 0) + 1 })), [])

  // Kısayol (Ayarlar → Kısayollar → Deploy formu)
  useEffect(() => {
    const on = () => open()
    window.addEventListener('memebot:deploy', on)
    return () => window.removeEventListener('memebot:deploy', on)
  }, [open])

  return (
    <Ctx.Provider value={{ open }}>
      {children}
      {state && <DeployPanel key={state.n} item={state.item} snapshot={state.snapshot} onClose={() => setState(null)} />}
    </Ctx.Provider>
  )
}

const b64Bytes = (b64: string) => Math.floor((b64.length * 3) / 4)

// Dosyayı base64'e çevir; 2 MB'tan büyükse 1024 px JPEG'e küçült.
// blob: adresi CSP'de (img-src) yasak; önizleme ve küçültme data: adresiyle yapılır.
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}

async function fileToBase64(file: File): Promise<{ data: string; bytes: number; preview: string }> {
  try {
    const src = await readAsDataUrl(file)
    if (file.size <= IMAGE_MAX_BYTES && /^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
      return { data: src.slice(src.indexOf(',') + 1), bytes: file.size, preview: src }
    }
    const img = new Image()
    img.src = src
    await img.decode()
    const k = Math.min(1, 1024 / Math.max(img.width, img.height))
    const c = document.createElement('canvas')
    c.width = Math.round(img.width * k)
    c.height = Math.round(img.height * k)
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    const dataUrl = c.toDataURL('image/jpeg', 0.85)
    const data = dataUrl.split(',')[1]
    return { data, bytes: b64Bytes(data), preview: dataUrl }
  } catch {
    throw new Error('Görsel okunamadı')
  }
}

function newKey() {
  return `${Date.now().toString(36)}-${crypto.randomUUID()}`
}

function DeployPanel({ item, snapshot, onClose }: { item?: FeedItem; snapshot?: Snapshot; onClose: () => void }) {
  const { profile } = useAuth()
  const { rule } = usePipeline()
  const { me, online, run } = useEngine()
  const { layout, preset, activePreset } = usePrefs()
  const killSwitch = useKillSwitch()
  const live = rule.limits.liveTrading
  const text = item?.text ?? ''
  const suggestions = useMemo(() => nameSuggestions(text), [text])
  const first = suggestions[0] ?? ''

  const [form, setForm] = useState<DeployForm>(() => ({
    platform: layout.deployPlatform ?? 'pump',
    name: first,
    symbol: first ? symbolFor(first) : '',
    twitter: item?.platform === 'x' && item.url ? item.url : undefined,
    telegram: item?.platform === 'telegram' && item.url ? item.url : undefined,
    image: item?.media[0] ? { kind: 'url', url: item.media[0].url } : null,
    buySol: 0,
    feeShares: [],
    autoSell: [],
    preset: activePreset,
    feedItemId: item?.id
  }))
  const [preview, setPreview] = useState<string | null>(item?.media[0]?.url ?? null)
  const [key] = useState(newKey)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ id: string; dryRun: boolean; request: Record<string, unknown> } | null>(null)
  const [deploy, setDeploy] = useState<{ status: string; mint: string | null; error: string | null } | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const wallets = useWallets()

  useEffect(() => nameRef.current?.focus(), [])

  // Gerçek deploy: sonuç (token adresi) gelene kadar izle
  useEffect(() => {
    if (!result || result.dryRun) return
    const load = () =>
      supabase
        .from('deploys')
        .select('status, mint, error')
        .eq('id', result.id)
        .single()
        .then(({ data }) => data && setDeploy(data))
    load()
    const ch = supabase
      .channel(`deploy-${result.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'deploys', filter: `id=eq.${result.id}` }, load)
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [result])

  // Deploy kesinleşince seçilen sitede aç
  useEffect(() => {
    if (deploy?.status !== 'confirmed' || !deploy.mint) return
    const where = layout.openAfterDeploy ?? 'gmgn'
    if (where === 'gmgn') window.open(`https://gmgn.ai/sol/token/${deploy.mint}`, '_blank')
    if (where === 'solscan') window.open(`https://solscan.io/token/${deploy.mint}`, '_blank')
  }, [deploy?.status, deploy?.mint, layout.openAfterDeploy])

  const set = <K extends keyof DeployForm>(k: K, v: DeployForm[K]) => setForm((f) => ({ ...f, [k]: v }))
  const errors = validateDeploy(form)
  const fees = preset(form.preset, 'deploy')
  const allowed = canTrade(profile?.role) && !killSwitch && online

  const pickName = (n: string) => setForm((f) => ({ ...f, name: n.slice(0, NAME_MAX), symbol: symbolFor(n) }))

  const useSnapshot = async () => {
    if (!snapshot) return
    const url = await snapshot()
    if (!url) return setError('Kart görüntüsü alınamadı')
    const data = url.split(',')[1]
    set('image', { kind: 'base64', data, bytes: b64Bytes(data) })
    setPreview(url)
  }

  const upload = async (file: File) => {
    try {
      const r = await fileToBase64(file)
      set('image', { kind: 'base64', data: r.data, bytes: r.bytes })
      setPreview(r.preview)
    } catch (e) {
      setError(errText(e))
    }
  }

  const submit = async () => {
    if (busy || result) return
    if (errors.length) return setError(errors.join(' · '))
    if (live && !confirm(`${form.symbol} GERÇEK olarak ${PLATFORM_LABEL[form.platform]}'da çıkarılacak${form.buySol ? `, ${form.buySol} SOL geliştirici alımıyla` : ''}. Devam?`)) return
    setBusy(true)
    setError(null)
    try {
      setResult(await run('deploy.submit', { form, key }, 60_000))
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  const shareTotal = form.feeShares.reduce((a, s) => a + s.percent, 0)
  const side = (layout.deployForm ?? 'modal') === 'side'

  return (
    <div className={side ? 'deploy-side-wrap' : 'modal-wrap'} onMouseDown={(e) => !side && e.target === e.currentTarget && onClose()}>
      <div
        className={side ? 'deploy-side' : 'modal'}
        role="dialog"
        aria-label="Token deploy"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
          if (e.key === 'Enter' && !e.shiftKey && (e.target as HTMLElement).tagName !== 'TEXTAREA') {
            e.preventDefault()
            submit()
          }
        }}
      >
        <header className="modal-head">
          <h1>
            Token Deploy
            <span className={`badge ${live ? 'fail' : 'warn'}`} title={live ? 'Gerçek işlem açık' : "Deneme modu — GMGN'e gönderilmez"}>
              {live ? 'GERÇEK' : 'DENEME'}
            </span>
          </h1>
          <div className="row" style={{ gap: 4 }}>
            <span className="wallet-chip" title="Varsayılan cüzdan (alım-satım da bu cüzdandan yapılır)">
              <WalletIcon size={12} />
              <select value={me?.gmgn.wallet ?? ''} disabled={!!result || wallets.busy} onChange={(e) => e.target.value && wallets.makeDefault(e.target.value)}>
                {!me?.gmgn.wallet && <option value="">cüzdan yok</option>}
                {wallets.rows
                  .filter((w) => !w.hidden || w.isDefault)
                  .map((w) => (
                    <option key={w.address} value={w.address}>
                      {w.label ?? shortAddr(w.address)}
                      {w.balance !== undefined ? ` · ${w.balance.toFixed(3)}` : ''}
                    </option>
                  ))}
              </select>
            </span>
            <button className="x-btn" title="Kapat (Esc)" onClick={onClose}>
              <X size={15} />
            </button>
          </div>
        </header>

        {item && (
          <div className="post-ref">
            <span className="post-ref-label">Kaynak gönderi · {item.author.name ?? item.author.handle}</span>
            <div className="post-ref-text">{item.text}</div>
          </div>
        )}

        {result ? (
          <DeployResultView result={result} deploy={deploy} onClose={onClose} />
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1fr)', gap: 8 }}>
              <label>
                <span className="field-label">
                  Ad <span className="faint">{form.name.length}/{NAME_MAX}</span>
                </span>
                <input ref={nameRef} maxLength={NAME_MAX} value={form.name} placeholder="Token adı" onChange={(e) => set('name', e.target.value)} />
              </label>
              <label>
                <span className="field-label">
                  Sembol <span className="faint">{form.symbol.length}/{SYMBOL_MAX}</span>
                  <button type="button" className="chip" style={{ marginLeft: 'auto', padding: '0 6px' }} title="Addan üret" onClick={() => set('symbol', symbolFor(form.name))}>
                    Otomatik
                  </button>
                </span>
                <input maxLength={SYMBOL_MAX} value={form.symbol} placeholder="Sembol" onChange={(e) => set('symbol', e.target.value.toUpperCase())} />
              </label>
            </div>
            {suggestions.length > 0 && (
              <div className="row" style={{ gap: 4 }}>
                {suggestions.map((s) => (
                  <button key={s} className={`chip ${form.name === s ? 'on' : ''}`} onClick={() => pickName(s)}>
                    {s}
                  </button>
                ))}
              </div>
            )}

            <label>
              <span className="field-label">Website</span>
              <input value={form.website ?? ''} onChange={(e) => set('website', e.target.value || undefined)} placeholder="https://example.com" />
            </label>
            <label>
              <span className="field-label">Gönderi (X)</span>
              <input value={form.twitter ?? ''} onChange={(e) => set('twitter', e.target.value || undefined)} placeholder="https://x.com/…" />
            </label>
            <label>
              <span className="field-label">Telegram</span>
              <input value={form.telegram ?? ''} onChange={(e) => set('telegram', e.target.value || undefined)} placeholder="https://t.me/…" />
            </label>

            <div style={{ display: 'grid', gap: 6 }}>
              <span className="field-label">Görsel</span>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <label className="deploy-img" title="Görsel yükle" style={{ cursor: 'pointer' }}>
                  {preview ? <img src={preview} alt="" referrerPolicy="no-referrer" /> : <Plus size={18} />}
                  <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
                </label>
                <div className="row" style={{ gap: 4 }}>
                  {!preview && (
                    <span className="faint" style={{ fontSize: 12, width: '100%' }}>
                      Görsel seçilmedi
                    </span>
                  )}
                  <label className="chip" style={{ display: 'inline-flex', flexDirection: 'row', gap: 4, alignItems: 'center' }}>
                    <Upload size={11} /> Yükle
                    <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
                  </label>
                  {snapshot && (
                    <button className="chip" onClick={useSnapshot}>
                      Kartın görüntüsü
                    </button>
                  )}
                  {item?.media.map((m, i) => (
                    <button
                      key={m.url}
                      className="chip"
                      onClick={() => {
                        set('image', { kind: 'url', url: m.url })
                        setPreview(m.url)
                      }}
                    >
                      Gönderi görseli {i + 1}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="plat-grid">
              {(Object.keys(PLATFORM_LABEL) as DeployPlatform[]).map((p) => (
                <button key={p} className={`plat ${form.platform === p ? 'on' : ''}`} onClick={() => set('platform', p)}>
                  {PLATFORM_LABEL[p]}
                </button>
              ))}
            </div>

            <div className="opt-grid">
              {form.platform !== 'bonk' && (
                <button
                  className={`opt ${form.feeShares.length ? 'on' : ''}`}
                  onClick={() => set('feeShares', form.feeShares.length ? [] : [{ provider: 'twitter', username: '', percent: 100 }])}
                >
                  <input type="checkbox" readOnly checked={form.feeShares.length > 0} tabIndex={-1} />
                  <Split size={13} /> Ücret paylaşımı
                </button>
              )}
              <button
                className={`opt ${form.autoSell.length ? 'on' : ''}`}
                onClick={() => set('autoSell', form.autoSell.length ? [] : [{ type: 'delay', seconds: 60, percent: 50 }])}
              >
                <input type="checkbox" readOnly checked={form.autoSell.length > 0} tabIndex={-1} />
                <Timer size={13} /> Otomatik satış
              </button>
            </div>

            {form.platform !== 'bonk' && form.feeShares.length > 0 && <FeeShares shares={form.feeShares} total={shareTotal} onChange={(v) => set('feeShares', v)} />}
            {form.autoSell.length > 0 && <AutoSells rows={form.autoSell} onChange={(v) => set('autoSell', v)} />}

            <label>
              <span className="field-label">Açıklama</span>
              <textarea rows={2} maxLength={500} value={form.description ?? ''} onChange={(e) => set('description', e.target.value || undefined)} />
            </label>

            <label>
              <span className="field-label">
                Geliştirici alımı <span className="faint">· en fazla {rule.limits.maxBuySol} SOL</span>
              </span>
              <span className="amount-bar">
                <SolMark size={14} />
                <input type="number" min={0} step="any" value={form.buySol} onChange={(e) => set('buySol', Math.max(0, Number(e.target.value) || 0))} />
                <span className="faint" style={{ fontSize: 11, fontWeight: 600 }}>
                  SOL
                </span>
              </span>
            </label>

            {error && <div className="notice error">{error}</div>}
            {killSwitch && <div className="notice error">İşlemler founder tarafından durduruldu; deploy yapılamaz.</div>}
            <div className="deploy-foot">
              <select
                className="input-sm"
                style={{ height: 36 }}
                value={form.preset}
                title={`Ücret P${form.preset}: öncelik ${fees.priorityFeeSol} · bribe ${fees.tipFeeSol} SOL · slippage ${fees.slippage === 'auto' ? 'otomatik' : `%${fees.slippage}`}`}
                onChange={(e) => set('preset', Number(e.target.value) as 1 | 2 | 3)}
              >
                {[1, 2, 3].map((s) => (
                  <option key={s} value={s}>
                    P{s}
                  </option>
                ))}
              </select>
              <button className="btn btn-primary" disabled={busy || !allowed || errors.length > 0} onClick={submit} title={errors[0]}>
                <Zap size={14} />
                {busy ? 'Gönderiliyor…' : `${live ? 'Deploy' : 'Deneme deploy'} (Enter)`}
              </button>
            </div>
            {errors.length > 0 && (form.name || form.symbol) && (
              <span className="faint" style={{ fontSize: 11, textAlign: 'center' }}>
                {errors[0]}
              </span>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function FeeShares({ shares, total, onChange }: { shares: FeeShare[]; total: number; onChange: (v: FeeShare[]) => void }) {
  return (
    <div className="sub-panel">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="field-label">
          Ücret paylaşımı {shares.length > 0 && <span className={Math.abs(total - 100) < 1e-9 ? 'pos' : 'neg'}>· toplam %{+total.toFixed(2)}</span>}
        </span>
        <button className="btn btn-xs" disabled={shares.length >= 10} onClick={() => onChange([...shares, { provider: 'twitter', username: '', percent: shares.length ? 0 : 100 }])}>
          Ekle
        </button>
      </div>
      {shares.map((s, i) => (
        <div key={i} className="row" style={{ flexWrap: 'nowrap' }}>
          <select value={s.provider} onChange={(e) => onChange(shares.map((x, j) => (j === i ? { ...x, provider: e.target.value as FeeShare['provider'] } : x)))}>
            <option value="twitter">X kullanıcısı</option>
            <option value="solana">Cüzdan</option>
            <option value="github">GitHub</option>
          </select>
          <input
            style={{ flex: 1 }}
            value={s.username}
            placeholder={s.provider === 'solana' ? 'Cüzdan adresi' : '@kullanıcı'}
            onChange={(e) => onChange(shares.map((x, j) => (j === i ? { ...x, username: e.target.value } : x)))}
          />
          <input
            type="number"
            min={0}
            max={100}
            style={{ width: 80 }}
            value={s.percent}
            onChange={(e) => onChange(shares.map((x, j) => (j === i ? { ...x, percent: Math.max(0, Number(e.target.value) || 0) } : x)))}
          />
          <span className="faint">%</span>
          <button className="icon-btn sm danger" title="Sil" onClick={() => onChange(shares.filter((_, j) => j !== i))}>
            <Trash2 size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}

function AutoSells({ rows, onChange }: { rows: AutoSell[]; onChange: (v: AutoSell[]) => void }) {
  return (
    <div className="sub-panel">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="field-label">
          Otomatik satış <span className="faint">· geliştirici alımı için</span>
        </span>
        <button className="btn btn-xs" disabled={rows.length >= 5} onClick={() => onChange([...rows, { type: 'delay', seconds: 60, percent: 50 }])}>
          Ekle
        </button>
      </div>
      {rows.map((r, i) => (
        <div key={i} className="row" style={{ flexWrap: 'nowrap' }}>
          <select
            value={r.type}
            onChange={(e) =>
              onChange(rows.map((x, j) => (j === i ? (e.target.value === 'delay' ? { type: 'delay', seconds: 60, percent: x.percent } : { type: 'mcap', mcapUsd: 100_000, percent: x.percent }) : x)))
            }
          >
            <option value="delay">Süre sonra</option>
            <option value="mcap">Piyasa değerinde</option>
          </select>
          {r.type === 'delay' ? (
            <>
              <input
                type="number"
                min={1}
                style={{ width: 90 }}
                value={r.seconds}
                onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...r, seconds: Math.max(1, Number(e.target.value) || 1) } : x)))}
              />
              <span className="faint">sn sonra</span>
            </>
          ) : (
            <>
              <span className="faint">$</span>
              <input
                type="number"
                min={1}
                style={{ width: 120 }}
                value={r.mcapUsd}
                onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...r, mcapUsd: Math.max(1, Number(e.target.value) || 1) } : x)))}
              />
              <span className="faint">MC'de</span>
            </>
          )}
          <span className="faint">%</span>
          <input
            type="number"
            min={1}
            max={100}
            style={{ width: 70 }}
            value={r.percent}
            onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, percent: Math.min(100, Math.max(1, Number(e.target.value) || 1)) } : x)))}
          />
          <span className="faint">sat</span>
          <button className="icon-btn sm danger" title="Sil" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
            <Trash2 size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}

function DeployResultView({
  result,
  deploy,
  onClose
}: {
  result: { dryRun: boolean; request: Record<string, unknown> }
  deploy: { status: string; mint: string | null; error: string | null } | null
  onClose: () => void
}) {
  return (
    <div className="stack">
      {result.dryRun ? (
        <div className="notice ok">Deneme deploy kaydedildi. GMGN'e hiçbir şey gönderilmedi; gerçek modda gönderilecek istek aşağıda.</div>
      ) : deploy?.status === 'confirmed' ? (
        <div className="notice ok">
          Token çıktı:{' '}
          {deploy.mint ? (
            <a className="mono" href={`https://gmgn.ai/sol/token/${deploy.mint}`} target="_blank" rel="noreferrer">
              {deploy.mint}
            </a>
          ) : (
            'adres henüz yok — GMGN üzerinden kontrol edin'
          )}
        </div>
      ) : deploy?.status === 'failed' ? (
        <div className="notice error">Deploy başarısız: {deploy.error}</div>
      ) : (
        <div className="notice">GMGN'e gönderildi, sonuç bekleniyor…</div>
      )}
      <pre className="log">{JSON.stringify(result.request, null, 2)}</pre>
      <div>
        <button className="btn" onClick={onClose}>
          Kapat
        </button>
      </div>
    </div>
  )
}
