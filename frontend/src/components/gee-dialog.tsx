import { useState } from "react"
import { motion } from "motion/react"
import { Check, Copy, X } from "lucide-react"
import { NeumorphEyebrow } from "@/components/ui/neumorph-eyebrow"
import { TextureButton } from "@/components/ui/texture-button"
import type { Crop, Meta } from "@/lib/api"
import { CROP_NAME } from "@/lib/constants"
import { codeEditorSnippet } from "@/lib/scripts"
import { Segmented } from "./segmented"

/** Code Editor snippet that shows the same map in Earth Engine. */
export function GeeDialog({ meta, crop, year, onClose }: { meta: Meta; crop: Crop; year: number; onClose: () => void }) {
  const [mode, setMode] = useState<"asset" | "recompute">("recompute")
  const [copied, setCopied] = useState(false)
  const code = codeEditorSnippet(meta, crop, year, mode)
  const copy = () => { navigator.clipboard?.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500) }
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-[2000] flex items-center justify-center bg-neutral-950/30 p-6 backdrop-blur-sm" onClick={onClose}>
      <motion.div initial={{ y: 12, scale: 0.97 }} animate={{ y: 0, scale: 1 }} className="w-full max-w-3xl rounded-3xl border bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start">
          <div>
            <NeumorphEyebrow intent="secondary">Same result in Earth Engine</NeumorphEyebrow>
            <h2 className="mt-3 text-xl font-semibold tracking-tight">{CROP_NAME[crop]} yield, {year}</h2>
            <p className="mt-1 text-sm text-muted-foreground">Copy, paste into the Earth Engine Code Editor and press Run: the same map, the same colours.</p>
          </div>
          <button onClick={onClose} className="ml-auto text-muted-foreground hover:text-foreground"><X size={18} /></button>
        </div>
        <Segmented className="mt-5" value={mode} onChange={setMode} options={[["recompute", "Recompute from scratch"], ["asset", "Load exported map"]]} />
        <pre className="mt-3 max-h-[45vh] overflow-auto rounded-2xl border bg-neutral-50 p-4 font-mono text-xs leading-relaxed text-neutral-700">{code}</pre>
        <div className="mt-4 flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{mode === "asset" ? "Needs the export task to finish first." : "Uses the same model coefficients as this site."}</span>
          <TextureButton variant="minimal" className="ml-auto w-auto" onClick={copy}>{copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy</>}</TextureButton>
          <TextureButton variant="primary" className="w-auto" onClick={() => window.open("https://code.earthengine.google.com/", "_blank", "noopener")}>Open Code Editor ↗</TextureButton>
        </div>
      </motion.div>
    </motion.div>
  )
}
