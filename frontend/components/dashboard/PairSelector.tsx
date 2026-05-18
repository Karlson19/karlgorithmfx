'use client';
import { PAIRS, ENABLED_SYMBOLS } from '@/lib/pairs';
import { cn } from '@/lib/utils';
import { ChevronDown } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';

interface PairSelectorProps {
  value: string;
  onChange: (symbol: string) => void;
  className?: string;
}

// Compact dropdown for switching the active trading pair.
// Used in the page header and anywhere else we need per-pair context.
export default function PairSelector({ value, onChange, className }: PairSelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = PAIRS[value] || PAIRS['EUR/USD'];

  // Click-outside to close
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 px-3 py-2 bg-card border border-border rounded-lg text-white font-mono text-sm hover:border-zinc-600 transition-colors"
      >
        <span className="font-semibold">{current.display_name}</span>
        <ChevronDown className={cn('w-4 h-4 text-text-secondary transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-64 bg-card border border-border rounded-lg shadow-xl z-50 overflow-hidden">
          {ENABLED_SYMBOLS.map(sym => {
            const meta = PAIRS[sym];
            const active = sym === value;
            return (
              <button
                key={sym}
                type="button"
                onClick={() => { onChange(sym); setOpen(false); }}
                className={cn(
                  'w-full text-left px-3 py-2.5 border-b border-border/50 last:border-0 transition-colors',
                  active ? 'bg-accent/10 text-accent' : 'text-white hover:bg-background/50'
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono font-semibold text-sm">{meta.display_name}</span>
                  {active && <span className="text-xs text-accent">active</span>}
                </div>
                <p className="text-text-secondary text-xs mt-0.5">{meta.description}</p>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
