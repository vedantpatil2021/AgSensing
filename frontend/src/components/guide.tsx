import { useEffect, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { AnimatePresence, motion } from "motion/react"
import { ArrowRight } from "lucide-react"
import { TextureButton } from "@/components/ui/texture-button"
import { cn } from "@/lib/utils"

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

/** Hover/focus explanation, rendered in a portal so scrolling panels never clip it. */
export function Tip({ text, children, below, className }: { text: ReactNode; children?: ReactNode; below?: boolean; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [r, setR] = useState<DOMRect | null>(null)
  const open = () => setR(ref.current!.getBoundingClientRect())
  return (
    <span ref={ref} className={cn("inline-flex", className)} onMouseEnter={open} onMouseLeave={() => setR(null)} onFocus={open} onBlur={() => setR(null)} tabIndex={children ? undefined : 0}>
      {children ?? <span className="flex size-4 cursor-help items-center justify-center rounded-full bg-neutral-100 text-[10px] font-bold text-sky-700">?</span>}
      {r && createPortal(
        <div className="pointer-events-none fixed z-[4000] max-w-64" style={{ left: clamp(r.left + r.width / 2 - 128, 8, innerWidth - 264), top: below ? r.bottom + 8 : r.top - 8, transform: below ? undefined : "translateY(-100%)" }}>
          <div className="rounded-xl border bg-white px-3 py-2 text-xs leading-relaxed text-foreground shadow-lg">{text}</div>
        </div>, document.body)}
    </span>
  )
}

export type TourStep = { target: string; title: string; text: string; before?: () => void }

/** Spotlight tour over elements marked with data-tour. Esc closes, arrow keys move. */
export function Tour({ steps, onClose }: { steps: TourStep[]; onClose: () => void }) {
  const [i, setI] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const step = steps[i]
  const next = () => (i + 1 < steps.length ? setI(i + 1) : onClose())

  useEffect(() => {
    step.before?.()
    const measure = () => setRect(document.querySelector(`[data-tour="${step.target}"]`)?.getBoundingClientRect() ?? null)
    const t = setTimeout(measure, step.before ? 350 : 40)
    addEventListener("resize", measure)
    return () => { clearTimeout(t); removeEventListener("resize", measure) }
  }, [i])

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); if (e.key === "ArrowRight") next(); if (e.key === "ArrowLeft" && i) setI(i - 1) }
    addEventListener("keydown", key)
    return () => removeEventListener("keydown", key)
  })

  const W = 330, H = 200
  let pos = { left: innerWidth / 2 - W / 2, top: innerHeight / 2 - H / 2 }
  if (rect) {
    if (rect.right + W + 24 < innerWidth && rect.width < innerWidth / 2) pos = { left: rect.right + 18, top: clamp(rect.top, 12, innerHeight - H - 12) }
    else if (rect.bottom + H + 20 < innerHeight) pos = { left: clamp(rect.left, 12, innerWidth - W - 12), top: rect.bottom + 16 }
    else pos = { left: clamp(rect.left - W - 18, 12, innerWidth - W - 12), top: clamp(rect.top, 12, innerHeight - H - 12) }
  }

  return createPortal(
    <div className="fixed inset-0 z-[3000]">
      {rect
        ? <div className="pointer-events-none absolute rounded-2xl outline-3 outline-offset-2 outline-white transition-all duration-300" style={{ left: rect.left - 6, top: rect.top - 6, width: rect.width + 12, height: rect.height + 12, boxShadow: "0 0 0 9999px rgba(10,10,10,.45)" }} />
        : <div className="absolute inset-0 bg-neutral-950/35" />}
      <AnimatePresence mode="wait">
        <motion.div key={i} initial={{ opacity: 0, y: 8, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }}
          className="absolute rounded-2xl border bg-white p-5 shadow-2xl" style={{ ...pos, width: W }}>
          <div className="flex items-center text-[11px] font-semibold uppercase tracking-wider text-emerald-700">
            Step {i + 1} of {steps.length}
            <button onClick={onClose} className="ml-auto font-normal normal-case tracking-normal text-muted-foreground hover:text-foreground">Skip</button>
          </div>
          <div className="mt-2 text-lg font-semibold">{step.title}</div>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{step.text}</p>
          <div className="mt-4 flex items-center gap-1.5">
            {steps.map((_, j) => <span key={j} className={cn("h-1.5 rounded-full transition-all", j === i ? "w-5 bg-neutral-900" : "w-1.5 bg-neutral-200")} />)}
            <div className="ml-auto flex gap-2">
              {i > 0 && <TextureButton variant="minimal" size="sm" className="w-auto" onClick={() => setI(i - 1)}>Back</TextureButton>}
              <TextureButton variant="primary" size="sm" className="w-auto" onClick={next}>{i + 1 < steps.length ? <>Next <ArrowRight size={13} /></> : "Done"}</TextureButton>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>, document.body)
}

/** Remembers whether a tour was seen; storage may be unavailable. */
export const seen = {
  get: (k: string) => { try { return localStorage.getItem(k) === "1" } catch { return false } },
  set: (k: string) => { try { localStorage.setItem(k, "1") } catch { /* ignore */ } },
  clear: (...keys: string[]) => { try { keys.forEach((k) => localStorage.removeItem(k)) } catch { /* ignore */ } },
}
