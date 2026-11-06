import { Fragment, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react"
import { AnimatePresence, motion } from "motion/react"
import { ArrowUp, Check, ChevronDown, Copy, RotateCcw, Sparkles, Square, SquarePen, X } from "lucide-react"
import type { Meta } from "@/lib/api"
import { MODELS, answer, starter, type AssistantContext, type ModelId } from "@/lib/assistant"
import { cn } from "@/lib/utils"

type Turn = { id: number; role: "user" | "assistant"; text: string; model?: ModelId; thought?: string; seconds?: number; state?: "thinking" | "writing" | "done" | "stopped" }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const MODEL_KEY = "ys_assistant_model"

/** **bold**, `code` and "- " bullet lines: all the replies use. */
function inline(text: string) {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) =>
    part.startsWith("**") ? <b key={i} className="font-semibold text-foreground">{part.slice(2, -2)}</b>
      : part.startsWith("`") ? <code key={i} className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-[12px]">{part.slice(1, -1)}</code>
        : <Fragment key={i}>{part}</Fragment>)
}
function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  let list: string[] = []
  const flush = () => { if (list.length) blocks.push(<ul key={blocks.length} className="my-1.5 space-y-1 pl-4 [&>li]:list-disc [&>li]:marker:text-neutral-400">{list.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>); list = [] }
  text.split("\n").forEach((line) => {
    if (line.startsWith("- ")) list.push(line.slice(2))
    else { flush(); if (line.trim()) blocks.push(<p key={blocks.length} className="my-1.5">{inline(line)}</p>) }
  })
  flush()
  return <>{blocks}</>
}

function ModelPicker({ value, onChange }: { value: ModelId; onChange: (m: ModelId) => void }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    addEventListener("mousedown", close)
    return () => removeEventListener("mousedown", close)
  }, [open])
  const current = MODELS.find((m) => m.id === value)!
  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-haspopup="listbox" aria-expanded={open}
        className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900">
        {current.name} <ChevronDown size={13} className={cn("transition", open && "rotate-180")} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.ul role="listbox" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }} transition={{ duration: 0.12 }}
            className="absolute bottom-full left-0 z-10 mb-1.5 w-60 rounded-xl border bg-white p-1 shadow-lg">
            {MODELS.map((m) => (
              <li key={m.id}>
                <button type="button" role="option" aria-selected={m.id === value} onClick={() => { onChange(m.id); setOpen(false) }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-neutral-50">
                  <span className="flex-1"><span className="block text-sm text-neutral-900">{m.name}</span><span className="block text-xs text-neutral-500">{m.note}</span></span>
                  {m.id === value && <Check size={15} className="text-neutral-900" />}
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  )
}

function AssistantTurn({ turn, onRetry }: { turn: Turn; onRetry: () => void }) {
  const [copied, setCopied] = useState(false)
  const [open, setOpen] = useState(false)
  const model = MODELS.find((m) => m.id === turn.model)
  return (
    <div className="group text-sm leading-relaxed text-neutral-700">
      <div className="mb-1 flex items-center gap-1.5 text-xs text-neutral-500">
        <span className="flex size-5 items-center justify-center rounded-md bg-neutral-900 text-white"><Sparkles size={11} /></span>
        {model?.name}
      </div>
      {turn.state === "thinking" ? (
        <div className="ys-shimmer py-1 text-sm">Thinking…</div>
      ) : turn.thought && (
        <button type="button" onClick={() => setOpen(!open)} className="mb-1 flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-800">
          Thought for {turn.seconds}s <ChevronDown size={12} className={cn("transition", open && "rotate-180")} />
        </button>
      )}
      {open && turn.state !== "thinking" && <p className="mb-2 border-l-2 pl-2.5 text-xs text-neutral-500">{turn.thought}</p>}
      {turn.text && <div><Markdown text={turn.text} />{turn.state === "writing" && <span className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse rounded-sm bg-neutral-800" />}</div>}
      {turn.state === "stopped" && <p className="mt-1 text-xs text-neutral-400">Stopped</p>}
      {(turn.state === "done" || turn.state === "stopped") && (
        <div className="mt-1 flex gap-0.5 opacity-60 transition group-hover:opacity-100">
          <button type="button" title="Copy" aria-label="Copy" onClick={() => { void navigator.clipboard?.writeText(turn.text); setCopied(true); setTimeout(() => setCopied(false), 1200) }}
            className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900">{copied ? <Check size={14} /> : <Copy size={14} />}</button>
          <button type="button" title="Regenerate" aria-label="Regenerate" onClick={onRetry} className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"><RotateCcw size={14} /></button>
        </div>
      )}
    </div>
  )
}

/** Chat panel that sits to the right of the map. */
export function Assistant({ meta, context, onClose }: { meta: Meta; context: AssistantContext; onClose: () => void }) {
  const [turns, setTurns] = useState<Turn[]>([])
  const [draft, setDraft] = useState("")
  const [model, setModel] = useState<ModelId>(() => {
    try { const m = localStorage.getItem(MODEL_KEY); return MODELS.some((x) => x.id === m) ? (m as ModelId) : "claude-sonnet-5-5" } catch { return "claude-sonnet-5-5" }
  })
  const [busy, setBusy] = useState(false)
  const run = useRef(0)
  const scroller = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const input = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { input.current?.focus() }, [])
  useEffect(() => { try { localStorage.setItem(MODEL_KEY, model) } catch { /* ignore */ } }, [model])
  useEffect(() => { if (pinned.current) scroller.current?.scrollTo({ top: scroller.current.scrollHeight }) }, [turns])
  useEffect(() => () => { run.current++ }, [])

  const patch = (id: number, p: Partial<Turn>) => setTurns((t) => t.map((x) => (x.id === id ? { ...x, ...p } : x)))

  const respond = async (question: string, id: number) => {
    const me = ++run.current, spec = MODELS.find((m) => m.id === model)!
    const reply = answer(question, context, meta)
    setBusy(true)
    const t0 = performance.now()
    await sleep((600 + Math.random() * 700) * spec.think)
    if (run.current !== me) return
    patch(id, { state: "writing", thought: reply.thought, seconds: Math.max(1, Math.round((performance.now() - t0) / 1000)) })
    const tokens = reply.text.match(/\S+\s*|\s+/g) ?? []
    let shown = ""
    for (let i = 0; i < tokens.length; i += 2) {
      shown += tokens.slice(i, i + 2).join("")
      patch(id, { text: shown })
      await sleep((22 + Math.random() * 38) / spec.speed)
      if (run.current !== me) return
    }
    patch(id, { state: "done" })
    setBusy(false)
  }

  const send = (text = draft) => {
    const question = text.trim()
    if (!question || busy) return
    const now = Date.now()
    setTurns((t) => [...t, { id: now, role: "user", text: question }, { id: now + 1, role: "assistant", text: "", model, state: "thinking" }])
    setDraft("")
    pinned.current = true
    void respond(question, now + 1)
  }
  const stop = () => {
    run.current++
    setBusy(false)
    setTurns((t) => t.map((x) => (x.state === "thinking" || x.state === "writing" ? { ...x, state: "stopped", thought: x.thought ?? "Stopped before answering." , seconds: x.seconds ?? 1 } : x)))
  }
  const retry = (id: number) => {
    const i = turns.findIndex((t) => t.id === id), question = turns[i - 1]?.text
    if (!question || busy) return
    setTurns((t) => t.map((x) => (x.id === id ? { ...x, text: "", model, state: "thinking", thought: undefined } : x)))
    void respond(question, id)
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() }
  }

  return (
    <aside className="fixed inset-0 z-[1600] flex min-h-0 flex-col bg-white lg:static lg:z-auto lg:w-[380px] lg:shrink-0 lg:border-l" aria-label="Assistant">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <span className="flex size-6 items-center justify-center rounded-md bg-neutral-900 text-white"><Sparkles size={13} /></span>
        <span className="text-sm font-semibold text-neutral-900">Assistant</span>
        <div className="ml-auto flex items-center gap-0.5">
          <button type="button" title="New chat" aria-label="New chat" disabled={!turns.length} onClick={() => { stop(); setTurns([]) }}
            className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-40"><SquarePen size={16} /></button>
          <button type="button" title="Close" aria-label="Close assistant" onClick={onClose} className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"><X size={16} /></button>
        </div>
      </div>

      <div ref={scroller} onScroll={(e) => { const el = e.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40 }}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {turns.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <span className="flex size-10 items-center justify-center rounded-xl bg-neutral-900 text-white shadow-sm"><Sparkles size={18} /></span>
            <p className="mt-3 text-base font-semibold text-neutral-900">Ask about these yield maps</p>
            <p className="mt-1 max-w-64 text-sm text-neutral-500">Years, counties, how seasons compare, or how the model works.</p>
            <button type="button" onClick={() => send(starter(meta))}
              className="mt-5 rounded-xl border bg-white px-3.5 py-2 text-left text-sm text-neutral-700 shadow-xs transition hover:border-neutral-400 hover:text-neutral-900">
              {starter(meta)}
            </button>
          </div>
        ) : (
          <div className="space-y-5">
            {turns.map((t) => t.role === "user"
              ? <motion.div key={t.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="ml-auto w-fit max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-neutral-100 px-3.5 py-2 text-sm text-neutral-900">{t.text}</motion.div>
              : <motion.div key={t.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }}><AssistantTurn turn={t} onRetry={() => retry(t.id)} /></motion.div>)}
          </div>
        )}
      </div>

      <div className="shrink-0 p-3 pt-0">
        <div className="rounded-2xl border bg-white shadow-xs transition focus-within:border-neutral-400 focus-within:ring-3 focus-within:ring-neutral-900/5">
          <textarea ref={input} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} rows={1} placeholder="Ask anything about the maps…"
            className="block max-h-40 min-h-11 w-full resize-none bg-transparent px-3.5 pt-3 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 [field-sizing:content]" />
          <div className="flex items-center justify-between px-2 pb-2">
            <ModelPicker value={model} onChange={setModel} />
            {busy
              ? <button type="button" onClick={stop} aria-label="Stop" className="flex size-8 items-center justify-center rounded-lg bg-neutral-900 text-white hover:bg-neutral-700"><Square size={12} fill="currentColor" /></button>
              : <button type="button" onClick={() => send()} disabled={!draft.trim()} aria-label="Send" className="flex size-8 items-center justify-center rounded-lg bg-neutral-900 text-white transition hover:bg-neutral-700 disabled:bg-neutral-200 disabled:text-neutral-400"><ArrowUp size={16} /></button>}
          </div>
        </div>
        <p className="mt-2 text-center text-[11px] text-neutral-400">Preview: answers are written from the demo map data in your browser.</p>
      </div>
    </aside>
  )
}
