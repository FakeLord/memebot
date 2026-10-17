import { useEffect, useRef, useState } from 'react'
import { canTrade, useAuth } from './auth'
import { usePipeline, type Rule, type RuleLimits, type TradeMode } from './pipeline'
import type { SafetyThresholds } from '../../../shared/safety'
import type { ConditionOrder } from '../../../shared/types'

// Kurallar düzenleme taslağı (Kurallar sayfası ve mini kurallar panosu ortak kullanır).
// Kural başka yerden değişirse (F1/F2, motorun otomatik modu kapatması) kaydedilmemiş taslak korunur;
// kaydederken etkin preset her zaman güncel kuraldan alınır (o alan başka yerden yönetilir).

export type Msg = { kind: 'ok' | 'error'; text: string } | null

export function validateRule(r: Rule): string | null {
  const l = r.limits
  if (!l.buyPresetsSol.some((n) => n > 0)) return 'En az bir hızlı alım tutarı girin.'
  if (!l.sellPresetsPct.some((n) => n > 0)) return 'En az bir hızlı satış yüzdesi girin.'
  if (l.sellPresetsPct.some((n) => n > 100)) return "Satış yüzdeleri %100'ü geçemez."
  if (!(l.maxBuySol > 0 && l.maxBuySol <= 5)) return 'İşlem başı maks. tutar 0 ile 5 SOL arasında olmalı.'
  if (r.mode === 'auto' && !(l.autoBuySol > 0 && l.autoBuySol <= l.maxBuySol))
    return "Otomatik alım tutarı 0'dan büyük ve işlem başı maks. tutardan küçük olmalı."
  for (const t of r.tpSl) {
    const ratio = Number(t.sell_ratio)
    if (!(ratio >= 1 && ratio <= 100)) return 'TP/SL satış oranı 1–100 olmalı.'
    if (t.order_type !== 'loss_stop_trace' && !(Number(t.price_scale) > 0)) return 'TP/SL satırlarında fiyat yüzdesi zorunlu.'
    if (t.order_type === 'loss_stop' && Number(t.price_scale) >= 100) return "Zarar durdur düşüşü %100'den küçük olmalı."
    if (t.order_type.endsWith('_trace') && !(Number(t.drawdown_rate) > 0 && Number(t.drawdown_rate) <= 100))
      return 'İz süren koşullarda geri çekilme yüzdesi zorunlu.'
  }
  return null
}

export function useRuleDraft() {
  const { profile } = useAuth()
  const { rule, saveRule } = usePipeline()
  const [draft, setDraft] = useState<Rule>(rule)
  const [msg, setMsg] = useState<Msg>(null)
  const [busy, setBusy] = useState(false)
  const editable = canTrade(profile?.role)
  const dirty = JSON.stringify(draft) !== JSON.stringify(rule)
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty

  // Kural dışarıdan değişince: taslak temizse güncelle, kirliyse sadece etkin preset'i eşitle
  useEffect(() => {
    setDraft((d) => (dirtyRef.current ? { ...d, limits: { ...d.limits, activePreset: rule.limits.activePreset } } : rule))
  }, [rule])

  const setL = <K extends keyof RuleLimits>(k: K, v: RuleLimits[K]) => {
    setMsg(null)
    setDraft((d) => ({ ...d, limits: { ...d.limits, [k]: v } }))
  }
  const setT = <K extends keyof SafetyThresholds>(k: K, v: SafetyThresholds[K]) => {
    setMsg(null)
    setDraft((d) => ({ ...d, thresholds: { ...d.thresholds, [k]: v } }))
  }
  const setTpSl = (fn: (rows: ConditionOrder[]) => ConditionOrder[]) => {
    setMsg(null)
    setDraft((d) => ({ ...d, tpSl: fn(d.tpSl) }))
  }

  const setMode = (m: TradeMode) => {
    if (m === draft.mode) return
    if (
      m === 'auto' &&
      !confirm(
        draft.limits.liveTrading
          ? 'Otomatik + GERÇEK işlem: güvenlikten geçen her token için onay sormadan gerçek SOL harcanacak. Emin misiniz?'
          : 'Otomatik mod deneme modunda çalışacak (para harcanmaz). Devam?'
      )
    )
      return
    setMsg(null)
    setDraft((d) => ({ ...d, mode: m }))
  }

  const setLive = (on: boolean) => {
    if (on && !confirm("Gerçek mod açılırsa onayladığınız token'lar için GMGN cüzdanınızdan GERÇEK SOL harcanır. Emin misiniz?")) return
    setL('liveTrading', on)
  }

  const save = async () => {
    const clean: Rule = {
      ...draft,
      limits: {
        ...draft.limits,
        activePreset: rule.limits.activePreset,
        buyPresetsSol: draft.limits.buyPresetsSol.filter((n) => n > 0).slice(0, 8),
        sellPresetsPct: draft.limits.sellPresetsPct.filter((n) => n > 0).slice(0, 8)
      }
    }
    const err = validateRule(clean)
    if (err) return setMsg({ kind: 'error', text: err })
    setBusy(true)
    const e = await saveRule(clean)
    setBusy(false)
    // Kaydedilen hal (boş yuvalar ayıklanmış) taslağın yeni hali olur; yoksa "kaydedilmemiş" görünmeye devam eder
    if (!e) setDraft(clean)
    setMsg(e ? { kind: 'error', text: e } : { kind: 'ok', text: 'Kaydedildi; yeni sinyallere hemen uygulanır.' })
  }

  const reset = () => {
    setMsg(null)
    setDraft(rule)
  }

  return { rule, draft, setDraft, setL, setT, setTpSl, setMode, setLive, save, reset, dirty, msg, busy, editable }
}

export type RuleDraft = ReturnType<typeof useRuleDraft>
