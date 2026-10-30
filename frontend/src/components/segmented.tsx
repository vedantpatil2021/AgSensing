import { motion } from "motion/react"
import { useId } from "react"
import { cn } from "@/lib/utils"

/** Controlled segmented control; the pill glides to the active option. */
export function Segmented<T extends string>({ value, onChange, options, className }: {
  value: T; onChange: (v: T) => void; options: [T, React.ReactNode][]; className?: string
}) {
  const id = useId()
  return (
    <div className={cn("flex rounded-2xl border bg-muted p-1", className)}>
      {options.map(([v, label]) => (
        <button key={v} onClick={() => onChange(v)} className={cn("relative flex-1 rounded-xl px-3 py-1.5 text-sm transition-colors", v === value ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
          {v === value && <motion.span layoutId={id} className="absolute inset-0 rounded-xl border bg-white shadow-sm" transition={{ type: "spring", stiffness: 400, damping: 32 }} />}
          <span className="relative">{label}</span>
        </button>
      ))}
    </div>
  )
}
