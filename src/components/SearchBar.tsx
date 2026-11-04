import { useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { SearchHit } from '@/lib/slideText'
import { cn } from '@/lib/utils'

interface Props {
  query: string
  onQueryChange: (q: string) => void
  hits: SearchHit[]
  /** Which hit is current (index into `hits`). */
  cursor: number
  onCursor: (i: number) => void
  onClose: () => void
}

/** Find-in-presentation bar with a short list of matching slides. */
export function SearchBar({ query, onQueryChange, hits, cursor, onCursor, onClose }: Props) {
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.select(), [])

  const step = (delta: number) => {
    if (hits.length) onCursor((cursor + delta + hits.length) % hits.length)
  }
  const total = hits.reduce((n, h) => n + h.count, 0)

  return (
    <div className="shrink-0 border-b" role="search">
      <div className="flex items-center gap-2 px-4 py-2">
        <Input
          ref={input}
          value={query}
          placeholder="Search slides and notes"
          aria-label="Search slides"
          className="h-8 max-w-sm"
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1) }
            else if (e.key === 'Escape') { e.preventDefault(); onClose() }
          }}
        />
        <span className="min-w-28 text-sm text-muted-foreground" aria-live="polite">
          {query.trim() ? (hits.length ? `${cursor + 1} of ${hits.length} slides · ${total} matches` : 'No matches') : ''}
        </span>
        <Button variant="ghost" size="sm" disabled={!hits.length} onClick={() => step(-1)}>Prev</Button>
        <Button variant="ghost" size="sm" disabled={!hits.length} onClick={() => step(1)}>Next</Button>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={onClose}>Close</Button>
      </div>
      {hits.length > 0 && (
        <ul className="max-h-36 overflow-auto border-t text-sm">
          {hits.map((hit, i) => (
            <li key={hit.index}>
              <button
                type="button"
                className={cn('flex w-full items-baseline gap-3 px-4 py-1 text-left hover:bg-accent', i === cursor && 'bg-accent')}
                onClick={() => onCursor(i)}
              >
                <span className="w-16 shrink-0 text-muted-foreground">Slide {hit.index + 1}</span>
                <span className="truncate">{hit.snippet}</span>
                {hit.inNotes && <span className="shrink-0 text-xs text-muted-foreground">notes</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
