import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent } from "react"
import { Navigate, useLocation, useNavigate } from "react-router-dom"
import { ArrowLeft, Loader2, Mail, ShieldCheck } from "lucide-react"
import { Brand } from "@/components/site-header"
import { NeumorphEyebrow } from "@/components/ui/neumorph-eyebrow"
import { TextureButton } from "@/components/ui/texture-button"
import { TextureCard } from "@/components/ui/texture-card"
import { seen } from "@/components/guide"
import { OrbitSurvey } from "@/figures/orbit-survey/orbit-survey"
import { useMeta } from "@/lib/api"
import { CODE_LENGTH, DEMO, DEMO_CODE, useAuth } from "@/lib/auth"

const RESEND_S = 60

function CodeBoxes({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled: boolean }) {
  const boxes = useRef<(HTMLInputElement | null)[]>([])
  const focus = (i: number) => boxes.current[Math.max(0, Math.min(CODE_LENGTH - 1, i))]?.focus()
  useEffect(() => focus(value.length), [])

  const put = (i: number, digits: string) => {
    const next = (value.slice(0, i) + digits).replace(/\D/g, "").slice(0, CODE_LENGTH)
    onChange(next)
    focus(next.length)
  }
  const onKey = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") { e.preventDefault(); onChange(value.slice(0, value[i] ? i : i - 1)); focus(value[i] ? i : i - 1) }
    else if (e.key === "ArrowLeft") focus(i - 1)
    else if (e.key === "ArrowRight") focus(i + 1)
  }
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => { e.preventDefault(); put(0, e.clipboardData.getData("text")) }

  return (
    <div className="flex justify-between gap-2" role="group" aria-label={`${CODE_LENGTH}-digit code`}>
      {Array.from({ length: CODE_LENGTH }, (_, i) => (
        <input key={i} ref={(el) => { boxes.current[i] = el }} value={value[i] ?? ""} disabled={disabled}
          inputMode="numeric" autoComplete={i === 0 ? "one-time-code" : "off"} maxLength={CODE_LENGTH} aria-label={`Digit ${i + 1}`}
          onChange={(e) => put(Math.min(i, value.length), e.target.value)} onKeyDown={(e) => onKey(i, e)} onPaste={onPaste}
          onFocus={(e) => e.target.select()}
          className="h-12 w-full min-w-0 rounded-lg border bg-white text-center text-lg font-semibold tabular-nums text-neutral-900 shadow-xs outline-none transition focus:border-neutral-900 focus:ring-3 focus:ring-neutral-900/10 disabled:opacity-60" />
      ))}
    </div>
  )
}

function SignInForm() {
  const navigate = useNavigate()
  const { sendCode, verifyCode } = useAuth()
  const from = (useLocation().state as { from?: string } | null)?.from ?? "/explore"
  const [email, setEmail] = useState("")
  const [step, setStep] = useState<"email" | "code">("email")
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [wait, setWait] = useState(0)

  useEffect(() => {
    if (!wait) return
    const t = setTimeout(() => setWait((w) => w - 1), 1000)
    return () => clearTimeout(t)
  }, [wait])

  const send = async () => {
    const address = email.trim().toLowerCase()
    setBusy(true); setError("")
    const error = await sendCode(address)
    setBusy(false)
    if (error) { setError(error); return }
    setEmail(address); setCode(""); setStep("code"); setWait(RESEND_S)
  }

  const verify = async (token = code) => {
    if (token.length !== CODE_LENGTH) return
    setBusy(true); setError("")
    const error = await verifyCode(email, token)
    setBusy(false)
    if (error) { setError(error); setCode(""); return }
    seen.clear("ys_explore_tour", "ys_studio_tour")      // every sign-in starts with the Help tour again
    navigate(from, { replace: true })
  }

  const submit = (e: FormEvent) => { e.preventDefault(); void (step === "email" ? send() : verify()) }

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      {step === "email" ? (
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-neutral-800">OSU email</span>
          <span className="relative block">
            <Mail size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input type="email" value={email} onChange={(e) => { setEmail(e.target.value); setError("") }} autoFocus autoComplete="email"
              placeholder="lastname.1@osu.edu" aria-invalid={!!error}
              className="h-11 w-full rounded-lg border bg-white pl-9 pr-3 text-sm text-neutral-900 shadow-xs outline-none transition placeholder:text-neutral-400 focus:border-neutral-900 focus:ring-3 focus:ring-neutral-900/10 aria-invalid:border-red-500" />
          </span>
        </label>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-neutral-600">{DEMO
            ? <>Demo sign-in for <span className="font-medium text-neutral-900">{email}</span>: no email is sent yet. Enter <span className="font-medium text-neutral-900">{DEMO_CODE}</span>.</>
            : <>We sent a {CODE_LENGTH}-digit code to <span className="font-medium text-neutral-900">{email}</span>. It works once and expires soon.</>}</p>
          <CodeBoxes value={code} disabled={busy} onChange={(v) => { setCode(v); setError(""); if (v.length === CODE_LENGTH) void verify(v) }} />
        </div>
      )}

      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <TextureButton type="submit" disabled={busy || (step === "code" && code.length !== CODE_LENGTH)} className="h-11 disabled:opacity-60">
        <span className="flex items-center gap-2 text-sm font-medium text-white">
          {busy && <Loader2 size={16} className="animate-spin" />}
          {step === "email" ? "Email me a code" : "Sign in"}
        </span>
      </TextureButton>

      {step === "code" && (
        <div className="flex items-center justify-between text-sm">
          <button type="button" onClick={() => { setStep("email"); setError("") }} className="flex items-center gap-1 text-neutral-600 hover:text-neutral-900">
            <ArrowLeft size={14} /> Different email
          </button>
          <button type="button" onClick={() => void send()} disabled={wait > 0 || busy} className="font-medium text-neutral-900 hover:underline disabled:font-normal disabled:text-neutral-400 disabled:no-underline">
            {wait > 0 ? `Resend in ${wait}s` : "Resend code"}
          </button>
        </div>
      )}
    </form>
  )
}

export default function Login() {
  const { email, ready } = useAuth()
  const meta = useMeta()
  if (ready && email) return <Navigate to="/explore" replace />

  const weather = meta && { temp: meta.layers.temp_2019.stats.mean, ppt: meta.layers.ppt_2019.stats.mean }
  return (
    <main className="grid min-h-svh bg-background lg:grid-cols-[minmax(0,1.25fr)_minmax(420px,1fr)]">
      <section className="order-2 flex flex-col justify-center gap-6 border-t bg-neutral-100/70 px-4 py-8 sm:px-8 lg:order-1 lg:border-r lg:border-t-0 lg:px-10">
        <div className="mx-auto w-full max-w-[720px]">
          <p className="mb-1 text-xs font-medium uppercase tracking-wider text-neutral-500">How Yield Studio works</p>
          <h2 className="mb-4 text-xl font-semibold text-neutral-900 sm:text-2xl">Satellite greenness and August weather, turned into a 30 m yield map.</h2>
          <div className="iso iso-embed overflow-hidden rounded-xl border bg-white shadow-sm" data-theme="light">
            {meta && weather ? <OrbitSurvey values={meta.scan.values} weather={weather} /> : <div className="aspect-[640/560]" />}
          </div>
        </div>
      </section>

      <section className="order-1 flex flex-col px-4 py-6 sm:px-8 lg:order-2 lg:px-12">
        <Brand sub="AgSensing Lab · The Ohio State University" />
        <div className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center py-10">
          <NeumorphEyebrow intent="default">
            <ShieldCheck size={13} className="mr-1.5" /> OSU accounts only
          </NeumorphEyebrow>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-neutral-900">Sign in</h1>
          <p className="mb-6 mt-2 text-sm text-neutral-600">No password. We email you a one-time code; enter it here to open the maps, Studio and your files.</p>
          <TextureCard>
            <div className="p-5 sm:p-6"><SignInForm /></div>
          </TextureCard>
          <p className="mt-4 text-xs leading-relaxed text-neutral-500">
            Only <span className="font-medium text-neutral-700">@osu.edu</span> and <span className="font-medium text-neutral-700">@buckeyemail.osu.edu</span> addresses can sign in.
            Your session stays signed in on this browser until you sign out.
          </p>
        </div>
        <p className="text-xs text-neutral-400">Yield Studio · research use</p>
      </section>
    </main>
  )
}
