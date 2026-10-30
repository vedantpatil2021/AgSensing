import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { Navigate, useLocation } from "react-router-dom"
import { createClient } from "@supabase/supabase-js"

export const ALLOWED_DOMAINS = ["osu.edu", "buckeyemail.osu.edu"]

/** Exactly name@osu.edu or name@buckeyemail.osu.edu: no other subdomains. The database checks this again. */
export function isOsuEmail(email: string) {
  const e = email.trim().toLowerCase()
  return /^[^@\s]+@[^@\s]+$/.test(e) && ALLOWED_DOMAINS.includes(e.split("@")[1])
}

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
export const supabase = url && key ? createClient(url, key) : null

/** Until Supabase is set up, sign-in is a demo: no email is sent and the code is always DEMO_CODE. */
export const DEMO = !supabase
export const DEMO_CODE = "0000"
export const CODE_LENGTH = DEMO ? DEMO_CODE.length : Number(import.meta.env.VITE_OTP_LENGTH ?? 6)
const DEMO_KEY = "yield-studio-demo-session"

const demoEmail = () => {
  try { const e = localStorage.getItem(DEMO_KEY); return e && isOsuEmail(e) ? e : null } catch { return null }
}

/** Supabase messages, in plain words. */
function explain(message: string) {
  if (/database error saving new user/i.test(message)) return "Only @osu.edu and @buckeyemail.osu.edu addresses can sign in."
  if (/after \d+ seconds|rate limit/i.test(message)) return "Too many codes asked for. Wait a minute and try again."
  if (/expired|invalid/i.test(message)) return "That code is wrong or has expired. Check it, or send a new one."
  return message
}

type Auth = {
  email: string | null
  ready: boolean
  sendCode: (email: string) => Promise<string | null>                 // error message, or null when sent
  verifyCode: (email: string, code: string) => Promise<string | null>
  signOut: () => Promise<void>
}
const AuthContext = createContext<Auth | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [email, setEmail] = useState<string | null>(DEMO ? demoEmail() : null)
  const [ready, setReady] = useState(DEMO)

  useEffect(() => {
    if (!supabase) return
    const accept = (e: string | null) => {
      if (e && !isOsuEmail(e)) { void supabase.auth.signOut(); e = null }
      setEmail(e)
      setReady(true)
    }
    supabase.auth.getSession().then(({ data }) => accept(data.session?.user.email ?? null))
    const { data } = supabase.auth.onAuthStateChange((_event, s) => accept(s?.user.email ?? null))   // refreshes, sign-outs in other tabs
    return () => data.subscription.unsubscribe()
  }, [])

  const sendCode = async (address: string) => {
    if (!isOsuEmail(address)) return `Use your ${ALLOWED_DOMAINS.map((d) => "@" + d).join(" or ")} address.`
    if (!supabase) return null
    const { error } = await supabase.auth.signInWithOtp({ email: address, options: { shouldCreateUser: true } })
    return error ? explain(error.message) : null
  }

  const verifyCode = async (address: string, code: string) => {
    if (!supabase) {
      if (code !== DEMO_CODE || !isOsuEmail(address)) return "That code is wrong. Check it and try again."
      try { localStorage.setItem(DEMO_KEY, address) } catch { /* the session then lasts until reload */ }
      setEmail(address)
      return null
    }
    const { error } = await supabase.auth.verifyOtp({ email: address, token: code, type: "email" })
    return error ? explain(error.message) : null
  }

  const signOut = async () => {
    if (supabase) await supabase.auth.signOut()
    try { localStorage.removeItem(DEMO_KEY) } catch { /* nothing stored */ }
    setEmail(null)
  }

  return <AuthContext.Provider value={{ email, ready, sendCode, verifyCode, signOut }}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)!

export function RequireAuth({ children }: { children: ReactNode }) {
  const { email, ready } = useAuth()
  const location = useLocation()
  if (!ready) return null
  return email ? children : <Navigate to="/login" replace state={{ from: location.pathname }} />
}

/** Calls the FastAPI backend with the user's access token. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = (await supabase?.auth.getSession())?.data.session?.access_token
  const res = await fetch((import.meta.env.VITE_API_URL ?? "http://localhost:8000") + path, {
    ...init, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers },
  })
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.detail ?? res.statusText)
  return res.json()
}
