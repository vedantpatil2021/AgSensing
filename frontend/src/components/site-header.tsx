import type { ReactNode } from "react"
import { Link, useNavigate } from "react-router-dom"
import { LogOut, Sprout } from "lucide-react"
import { useAuth } from "@/lib/auth"

export function Brand({ sub }: { sub?: string }) {
  return (
    <Link to="/explore" className="flex shrink-0 items-center gap-2.5">
      <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-b from-neutral-700 to-black text-white shadow-sm"><Sprout size={18} /></span>
      <span className="leading-tight">
        <span className="block font-semibold">Yield Studio</span>
        {sub && <span className="block text-xs text-muted-foreground">{sub}</span>}
      </span>
    </Link>
  )
}

function Account() {
  const { email, signOut } = useAuth()
  const navigate = useNavigate()
  if (!email) return null
  return (
    <div className="ml-1 flex items-center gap-2 border-l pl-3">
      <span className="hidden max-w-48 truncate text-xs text-muted-foreground md:block" title={email}>{email}</span>
      <button onClick={async () => { await signOut(); navigate("/login", { replace: true }) }} title="Sign out" aria-label="Sign out"
        className="flex size-8 items-center justify-center rounded-lg border bg-white text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900">
        <LogOut size={15} />
      </button>
    </div>
  )
}

export function SiteHeader({ sub, children }: { sub?: string; children?: ReactNode }) {
  return (
    <header className="sticky top-0 z-[1500] flex h-16 shrink-0 items-center gap-3 border-b bg-background/85 px-4 backdrop-blur sm:px-6">
      <Brand sub={sub} />
      <div className="ml-auto flex items-center gap-2">{children}<Account /></div>
    </header>
  )
}
