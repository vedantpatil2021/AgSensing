import { useEffect, useState } from "react"
import { Pause, Play } from "lucide-react"
import { RollingNumber } from "@/components/ui/rolling-number"
import { TextureButton } from "@/components/ui/texture-button"
import { YEARS, yearMeans, type Crop, type Meta } from "@/lib/api"
import { fmt } from "@/lib/constants"
import { cn } from "@/lib/utils"

/** Year bars (height = average yield) with play/pause. */
export function YearTimeline({ meta, crop, year, onYear }: { meta: Meta; crop: Crop; year: number; onYear: (y: number) => void }) {
  const [playing, setPlaying] = useState(false)
  const means = yearMeans(meta, crop)
  const lo = Math.min(...means), hi = Math.max(...means)

  useEffect(() => {
    if (!playing) return
    const t = setTimeout(() => onYear(year >= 2019 ? 2009 : year + 1), 1000)
    return () => clearTimeout(t)
  }, [playing, year])

  return (
    <div className="glass flex items-center gap-3 px-3 py-2.5">
      <TextureButton variant="primary" size="icon" className="w-9" onClick={() => setPlaying(!playing)} aria-label={playing ? "Pause" : "Play all years"}>
        <span className="p-1.5">{playing ? <Pause size={14} /> : <Play size={14} />}</span>
      </TextureButton>
      <div className="flex h-10 items-end gap-[3px]">
        {YEARS.map((y, i) => (
          <button key={y} onClick={() => { setPlaying(false); onYear(y) }} title={`${y}: average ${fmt(means[i])} t/ha`} className="group flex flex-col items-center gap-1">
            <div className={cn("w-6 rounded-sm transition-all", y === year ? "bg-neutral-900" : "bg-neutral-200 group-hover:bg-neutral-300")} style={{ height: 6 + ((means[i] - lo) / (hi - lo || 1)) * 20 }} />
            <span className={cn("text-[10px] tabular-nums", y === year ? "font-semibold text-foreground" : "text-muted-foreground")}>{String(y).slice(2)}</span>
          </button>
        ))}
      </div>
      <div className="border-l pl-3">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Average {year}</div>
        <div className="text-lg font-semibold tabular-nums"><RollingNumber value={meta.layers[`yield_${crop}_${year}`].stats.mean} precision={2} format={(v) => v.toFixed(2)} /> <span className="text-xs font-normal text-muted-foreground">t/ha</span></div>
      </div>
    </div>
  )
}
