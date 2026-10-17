import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'

// Taşınabilir ve boyutlandırılabilir mini pano (alt çubuktaki tüm paneller bunu kullanır).
//  - Başlıktan sürüklenir; sağ alt köşeden büyütülüp küçültülür; başlığa çift tıklayınca daralır
//  - Konum, boyut ve daraltma panel başına tarayıcıda hatırlanır; pano ekrandan taşmaz
//  - İlk açılışta tıklanan düğmenin üstünde, alt çubuğun hemen üzerinde açılır

interface Box {
  x: number
  y: number | null // null: henüz ölçülmedi (alt çubuğun üstüne yerleştirilecek)
  w: number
  h: number | null // null: içeriğe göre yükseklik
  collapsed?: boolean
}

const BAR = 38 // alt çubuk + boşluk
const MIN_H = 120
let zTop = 80

function load(id: string): Box | null {
  try {
    const b = JSON.parse(localStorage.getItem(`memebot.panel.${id}`) ?? 'null') as Box | null
    return b && Number.isFinite(b.x) && Number.isFinite(b.w) ? b : null
  } catch {
    return null
  }
}

function clamp(b: Box, height: number, minW: number): Box {
  const w = Math.max(minW, Math.min(b.w, window.innerWidth - 16))
  const x = Math.max(8, Math.min(b.x, window.innerWidth - w - 8))
  const h = b.h === null ? null : Math.max(MIN_H, Math.min(b.h, window.innerHeight - 16))
  const y = b.y === null ? null : Math.max(8, Math.min(b.y, window.innerHeight - Math.min(height, window.innerHeight - 16) - 8))
  return { ...b, x, y, w, h }
}

const same = (a: Box, b: Box) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h && a.collapsed === b.collapsed

export function FloatingPanel({
  id,
  title,
  head,
  anchorX = 12,
  width = 300,
  minW = 260,
  className,
  onClose,
  children
}: {
  id: string
  title: string
  head?: ReactNode // başlık yerine özel içerik (sürükleme bölgesi yine başlık satırıdır)
  anchorX?: number
  width?: number
  minW?: number
  className?: string
  onClose: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<Box>(() => load(id) ?? { x: anchorX, y: null, w: width, h: null })
  const [z, setZ] = useState(() => ++zTop)
  const fit = useCallback((b: Box) => clamp(b, ref.current?.offsetHeight ?? 200, minW), [minW])

  // İlk yerleşim: alt çubuğun hemen üstü
  useLayoutEffect(() => {
    if (box.y !== null || !ref.current) return
    const h = ref.current.offsetHeight
    setBox((b) => fit({ ...b, y: window.innerHeight - BAR - h }))
  }, [box.y, fit])

  // İçerik büyüyünce ya da pencere küçülünce ekranda kal
  useEffect(() => {
    const el = ref.current
    if (!el) return
    // Dar ekranda (telefon) CSS panoyu tam genişlikte alta yerleştirir; kayıtlı konum/boyut bozulmasın
    const refit = () =>
      window.innerWidth <= 760 ? undefined : setBox((b) => (b.y === null ? b : ((n) => (same(n, b) ? b : n))(fit(b))))
    const ro = new ResizeObserver(refit)
    ro.observe(el)
    window.addEventListener('resize', refit)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', refit)
    }
  }, [fit])

  useEffect(() => {
    if (box.y === null) return
    try {
      localStorage.setItem(`memebot.panel.${id}`, JSON.stringify(box))
    } catch {
      /* depolama kapalı olabilir */
    }
  }, [box, id])

  const front = () => setZ(++zTop)

  const drag = (e: React.PointerEvent, kind: 'move' | 'resize') => {
    if (kind === 'move' && (e.target as HTMLElement).closest('button, input, select, textarea, a')) return
    if (box.y === null) return
    e.preventDefault()
    front()
    const start = { px: e.clientX, py: e.clientY, ...box, h: box.h ?? ref.current?.offsetHeight ?? 300 }
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - start.px
      const dy = ev.clientY - start.py
      setBox((b) => fit(kind === 'move' ? { ...b, x: start.x + dx, y: start.y! + dy } : { ...b, w: start.w + dx, h: start.h + dy }))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.userSelect = ''
    }
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const toggleCollapse = () => setBox((b) => ({ ...b, collapsed: !b.collapsed }))

  return (
    <div
      ref={ref}
      className={`float-panel ${className ?? ''} ${box.collapsed ? 'collapsed' : ''}`}
      role="dialog"
      aria-label={title}
      onPointerDown={front}
      style={{
        left: box.x,
        top: box.y ?? -9999,
        width: box.w,
        height: box.collapsed ? undefined : (box.h ?? undefined),
        zIndex: z
      }}
    >
      <div className="float-head" onPointerDown={(e) => drag(e, 'move')} onDoubleClick={toggleCollapse} title="Sürükleyerek taşıyın · çift tıklayınca daralır">
        {head ?? <h3>{title}</h3>}
        <span className="spacer" />
        <button className="x-btn" title={box.collapsed ? 'Genişlet' : 'Daralt'} onClick={toggleCollapse}>
          {box.collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
        <button className="x-btn" title="Kapat" onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      {!box.collapsed && <div className="float-body">{children}</div>}
      {!box.collapsed && <div className="float-resize" title="Boyutlandır" onPointerDown={(e) => drag(e, 'resize')} />}
    </div>
  )
}
