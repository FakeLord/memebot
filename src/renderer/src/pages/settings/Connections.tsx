import { useEffect, useState } from 'react'
import { Copy, Cpu, ExternalLink, FileText, KeyRound, PlugZap, RefreshCw, Save, Server, Sparkles, Trash2 } from 'lucide-react'
import { useAuth } from '../../lib/auth'
import { errText, useEngine } from '../../lib/engine'
import { desktop } from '../../lib/platform'
import { Section, SettingRow, Stat, StatusPill, Toggle, since } from '../../components/ui'
import type { EngineHostStatus } from '../../../../shared/types'
import type { GmgnPlan } from '../../../../shared/engine'

// GMGN ve motor: motorun durumu, GMGN API anahtarı (mühürlü zarfla motora gider), masaüstünde motoru bu bilgisayarda çalıştırma.

type Msg = { kind: 'ok' | 'error'; text: string } | null

export function ConnectionsSection() {
  const { profile } = useAuth()
  return (
    <div>
      <EngineSection />
      <GmgnSection />
      {desktop && profile?.role === 'founder' && <EngineHostSection />}
    </div>
  )
}

function EngineSection() {
  const { online, status } = useEngine()
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 5_000)
    return () => clearInterval(t)
  }, [])
  return (
    <Section
      icon={Server}
      title="Motor"
      actions={<StatusPill tone={online ? 'on' : 'off'}>{online ? 'Çalışıyor' : 'Çalışmıyor'}</StatusPill>}
      note="Sinyalleri dinleyen, güvenlik kontrolü yapan ve alım-satımı yürüten motor 7/24 tek bir yerde çalışır. Bu ekran (tarayıcı ya da masaüstü) sadece arayüzdür; kapatsanız da motor çalışmaya devam eder."
    >
      <div className="stat-grid">
        <Stat label="Konum" value={status?.host ?? '—'} />
        <Stat label="Sürüm" value={<span className="mono">{status?.version ?? '—'}</span>} />
        <Stat label="Açılış" value={since(status?.started_at)} />
        <Stat label="Son sinyal" value={since(status?.heartbeat_at)} tone={online ? undefined : 'neg'} />
        <Stat label="GMGN gecikmesi" value={online && status?.gmgn_latency_ms != null ? `${status.gmgn_latency_ms} ms` : '—'} tone={online ? 'pos' : undefined} />
      </div>
    </Section>
  )
}

function GmgnSection() {
  const { me, online, run, runSealed } = useEngine()
  const [apiKey, setApiKey] = useState('')
  const [pem, setPem] = useState('')
  const [msg, setMsg] = useState<Msg>(null)
  const [busy, setBusy] = useState(false)
  const [edit, setEdit] = useState(false)
  // İmza anahtarı: motorda üretilir (önerilen; özel anahtar motordan çıkmaz) ya da elle yapıştırılır
  const [mode, setMode] = useState<'generate' | 'paste'>('generate')
  const configured = me?.gmgn.configured === true
  const plan = me?.gmgn.plan ?? 'free'
  const pendingPub = me?.gmgn.pendingPublicKey ?? null

  const act = async <T,>(fn: () => Promise<T>, ok: string | ((r: T) => string)) => {
    setBusy(true)
    setMsg(null)
    try {
      const r = await fn()
      setMsg({ kind: 'ok', text: typeof ok === 'function' ? ok(r) : ok })
      return true
    } catch (e) {
      setMsg({ kind: 'error', text: errText(e) })
      return false
    } finally {
      setBusy(false)
    }
  }

  const keygen = (fresh: boolean) =>
    act(() => run('gmgn.keygen', { fresh }), 'Anahtar çifti motorda oluşturuldu. Açık anahtarı kopyalayıp GMGN’e yapıştırın.')

  const copyPub = async () => {
    if (!pendingPub) return
    try {
      await navigator.clipboard.writeText(pendingPub)
      setMsg({ kind: 'ok', text: 'Açık anahtar kopyalandı.' })
    } catch {
      setMsg({ kind: 'error', text: 'Kopyalanamadı — metni seçip elle kopyalayın.' })
    }
  }

  const save = async () => {
    const privateKeyPem = mode === 'paste' ? pem : '' // boşsa motor bekleyen (üretilmiş) anahtarı kullanır
    if (await act(() => runSealed('gmgn.save', { apiKey, privateKeyPem }), 'Anahtar motora şifreli olarak kaydedildi.')) {
      setApiKey('')
      setPem('')
      setEdit(false)
    }
  }

  const showForm = !configured || edit

  return (
    <Section
      icon={KeyRound}
      title="GMGN API"
      actions={<StatusPill tone={me ? (configured ? 'on' : 'off') : undefined}>{me ? (configured ? 'Anahtar kayıtlı' : 'Anahtar yok') : '…'}</StatusPill>}
      note={
        <>
          Anahtarınızı <span className="mono">gmgn.ai/ai</span> adresinden alın. Anahtar bu ekranda motorun açık anahtarıyla şifrelenir; Supabase'e düz metin
          gitmez, sadece motor açabilir ve kendi kasasında şifreli saklar.
          {!online && ' Motor çalışmadığı için anahtar işlemleri şu an yapılamaz.'}
        </>
      }
    >
      {msg && <div className={`notice ${msg.kind}`} style={{ marginBottom: 6 }}>{msg.text}</div>}
      {configured && (
        <>
          <SettingRow title="Plan" desc="GMGN istek hızı sınırı; motor buna göre bekler">
            <select
              className="input-sm"
              value={plan}
              disabled={busy || !online}
              onChange={(e) => act(() => run('gmgn.plan', { plan: e.target.value as GmgnPlan }), 'Plan güncellendi.')}
            >
              <option value="free">Free — 5 istek/sn</option>
              <option value="plus">Plus — 20 istek/sn</option>
              <option value="pro">Pro — 50 istek/sn</option>
            </select>
          </SettingRow>
          <SettingRow title="Bağlantı testi" desc="Motor GMGN'e örnek bir istek gönderir">
            <button className="btn btn-sm" disabled={busy || !online} onClick={() => {
                const t0 = performance.now()
                act(
                  () => run('gmgn.test', {}),
                  (r) => `GMGN bağlantısı çalışıyor · GMGN ${r.ms} ms · uçtan uca ${Math.round(performance.now() - t0)} ms`
                )
              }}>
              <PlugZap size={13} /> Test et
            </button>
          </SettingRow>
          <SettingRow title="Anahtar" desc="Yeni bir anahtar girin ya da kayıtlı olanı motordan silin">
            <button className="btn btn-sm" disabled={busy} onClick={() => setEdit((v) => !v)}>
              {edit ? 'Vazgeç' : 'Değiştir'}
            </button>
            <button
              className="btn btn-sm btn-danger"
              disabled={busy || !online}
              onClick={() => confirm('GMGN anahtarı motordan silinsin mi?') && act(() => run('gmgn.clear', {}), 'Anahtar silindi.')}
            >
              <Trash2 size={13} /> Sil
            </button>
          </SettingRow>
        </>
      )}
      {showForm && (
        <div style={{ marginTop: configured ? 4 : 0 }}>
          <SettingRow title="İmza anahtarı" desc="GMGN API isteklerini imzalayan Ed25519 anahtar çifti. Cüzdan anahtarı DEĞİL." stacked>
            <div className="seg" style={{ maxWidth: 360 }}>
              <button className={`seg-btn${mode === 'generate' ? ' on' : ''}`} onClick={() => setMode('generate')}>
                Motorda oluştur (önerilen)
              </button>
              <button className={`seg-btn${mode === 'paste' ? ' on' : ''}`} onClick={() => setMode('paste')}>
                Kendi anahtarımı yapıştır
              </button>
            </div>
          </SettingRow>
          {mode === 'generate' ? (
            !pendingPub ? (
              <SettingRow title="1. Anahtar çifti" desc="Motor bir çift üretir. Özel anahtar motorun kasasında kalır, hiçbir yerde gösterilmez; size sadece açık anahtar verilir.">
                <button className="btn btn-sm btn-primary" disabled={busy || !online} onClick={() => keygen(false)}>
                  <Sparkles size={13} /> Anahtar çifti oluştur
                </button>
              </SettingRow>
            ) : (
              <SettingRow
                title="1. Açık anahtar (PUBLIC KEY)"
                desc={
                  <>
                    Bunu kopyalayın ve <span className="mono">gmgn.ai/ai</span> sayfasında API Key oluştururken "public key" alanına yapıştırın. Açık
                    anahtar gizli değildir.
                  </>
                }
                stacked
              >
                <textarea rows={3} className="mono" readOnly value={pendingPub} onFocus={(e) => e.currentTarget.select()} />
                <div className="row" style={{ gap: 6, marginTop: 6 }}>
                  <button className="btn btn-sm btn-primary" onClick={copyPub}>
                    <Copy size={13} /> Kopyala
                  </button>
                  <a className="btn btn-sm" href="https://gmgn.ai/ai" target="_blank" rel="noreferrer">
                    <ExternalLink size={13} /> gmgn.ai/ai'yi aç
                  </a>
                  <button
                    className="btn btn-sm"
                    disabled={busy || !online}
                    onClick={() =>
                      confirm('Yeni bir anahtar çifti üretilsin mi? Eski açık anahtarı GMGN’e yüklediyseniz o API Key bu çiftle çalışmaz.') && keygen(true)
                    }
                  >
                    <RefreshCw size={13} /> Yenisini üret
                  </button>
                </div>
              </SettingRow>
            )
          ) : (
            <SettingRow title="Özel anahtar (PRIVATE KEY)" desc="&quot;-----BEGIN PRIVATE KEY-----&quot; satırı dahil tamamını yapıştırın. Açık anahtar buraya girilmez." stacked>
              <textarea
                rows={4}
                value={pem}
                onChange={(e) => setPem(e.target.value)}
                spellCheck={false}
                placeholder={'-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----'}
              />
            </SettingRow>
          )}
          <SettingRow title={mode === 'generate' ? '2. API Key' : 'API Key'} desc="GMGN'in açık anahtarınız için verdiği API Key (gmgn.ai/ai → API)">
            <input
              className="input-sm mono"
              style={{ width: 280 }}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </SettingRow>
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
            <button className="btn btn-sm btn-primary" disabled={busy || !online || !apiKey || (mode === 'paste' ? !pem : !pendingPub)} onClick={save}>
              <Save size={13} /> Şifreleyip kaydet
            </button>
          </div>
        </div>
      )}
    </Section>
  )
}

// Masaüstü + founder: motoru bu bilgisayarda çalıştırma ayarı (VPS'e geçene kadar)
function EngineHostSection() {
  const [st, setSt] = useState<EngineHostStatus | null>(null)
  const [key, setKey] = useState('')
  const [msg, setMsg] = useState<Msg>(null)
  const [showLogs, setShowLogs] = useState(false)

  useEffect(() => {
    const load = () => desktop?.engine.status().then(setSt)
    load()
    const t = setInterval(load, 3_000)
    return () => clearInterval(t)
  }, [])

  const configure = async (patch: { enabled?: boolean; serviceRoleKey?: string }, ok: string) => {
    const r = await desktop!.engine.configure(patch)
    if (r.ok) {
      setSt(r.status)
      setMsg({ kind: 'ok', text: ok })
      setKey('')
    } else setMsg({ kind: 'error', text: r.error })
  }

  if (!st) return null
  return (
    <Section
      icon={Cpu}
      title="Bu bilgisayarda motor"
      actions={<StatusPill tone={st.running ? 'on' : st.enabled ? 'wait' : undefined}>{st.running ? 'Çalışıyor' : st.enabled ? 'Açık, çalışmıyor' : 'Kapalı'}</StatusPill>}
      note={
        <>
          Proje VPS'e taşınana kadar motor bu bilgisayarda, uygulama açıkken arka planda çalışır. Bunun için Supabase <b>service_role</b> anahtarı gerekir
          (Supabase → Project Settings → API Keys). Anahtar sadece bu bilgisayarda Windows şifrelemesiyle saklanır; başka hiçbir yere gönderilmez.
        </>
      }
    >
      {msg && <div className={`notice ${msg.kind}`} style={{ marginBottom: 6 }}>{msg.text}</div>}
      <SettingRow title="Motor bu bilgisayarda çalışsın" desc={st.hasServiceKey ? 'Uygulama açıkken arka planda' : 'Önce service_role anahtarını kaydedin'}>
        <Toggle
          checked={st.enabled}
          disabled={!st.hasServiceKey}
          onChange={(v) => configure({ enabled: v }, v ? 'Motor başlatılıyor…' : 'Motor bu bilgisayarda durduruldu.')}
        />
      </SettingRow>
      <SettingRow title="service_role anahtarı" desc={st.hasServiceKey ? 'Kayıtlı — değiştirmek için yenisini girin' : 'Kayıtlı değil'}>
        <input
          type="password"
          className="input-sm"
          style={{ width: 240 }}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="service_role"
          autoComplete="off"
        />
        <button className="btn btn-sm" disabled={!key.trim()} onClick={() => configure({ serviceRoleKey: key }, 'Anahtar kaydedildi.')}>
          Kaydet
        </button>
      </SettingRow>
      <SettingRow title="Motor günlüğü" desc={`${st.logs.length} satır`}>
        <button className="btn btn-sm" onClick={() => setShowLogs((v) => !v)}>
          <FileText size={13} /> {showLogs ? 'Gizle' : 'Göster'}
        </button>
      </SettingRow>
      {showLogs && (
        <pre className="log" style={{ marginTop: 4 }}>
          {st.logs.length ? st.logs.join('\n') : 'Henüz kayıt yok.'}
        </pre>
      )}
    </Section>
  )
}
