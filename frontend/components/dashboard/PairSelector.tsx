'use client';
import { PAIRS, ENABLED_SYMBOLS } from '@/lib/pairs';
import { cn } from '@/lib/utils';
import { ChevronDown, X } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';

interface PairSelectorProps {
  value: string;
  onChange: (symbol: string) => void;
  className?: string;
}

// Compact dropdown for switching the active trading pair.
// Used in the page header and anywhere else we need per-pair context.
//
// Mobile vs desktop:
//   - Desktop (sm+): anchored dropdown below the button (absolute right-0).
//   - Mobile (< sm): a bottom sheet fixed to the viewport with a backdrop.
//     This avoids the bug where the absolute dropdown got clipped by the
//     page's overflow-auto <main> container or pushed off-screen when the
//     header wrapped — content ended up jammed in a corner, invisible.
export default function PairSelector({ value, onChange, className }: PairSelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = PAIRS[value] || PAIRS['EUR/USD'];

  // Click-outside to close (desktop). On mobile the backdrop handles it.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  // Lock body scroll while the mobile sheet is open so the page behind
  // doesn't scroll under the sheet.
  useEffect(() => {
    if (open && typeof window !== 'undefined' && window.innerWidth < 640) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = prev; };
    }
  }, [open]);

  const options = ENABLED_SYMBOLS.map(sym => {
    const meta = PAIRS[sym];
    const active = sym === value;
    return (
      <button
        key={sym}
        type="button"
        onClick={() => { onChange(sym); setOpen(false); }}
        className={cn(
          'w-full text-left px-4 py-3 sm:py-2.5 border-b border-border/50 last:border-0 transition-colors',
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
  });

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
        <>
          {/* Mobile backdrop — tap to close. Hidden on desktop. */}
          <div
            className="fixed inset-0 z-40 bg-black/50 sm:hidden"
            onClick={() => setOpen(false)}
          />

          {/* The panel:
              - Mobile: fixed bottom sheet, full width minus margins, scrollable.
              - Desktop: absolute dropdown anchored to the button's right edge. */}
          <div className={cn(
            'bg-card border border-border shadow-2xl overflow-y-auto z-50',
            // Mobile bottom sheet
            'fixed inset-x-3 bottom-3 rounded-xl max-h-[70vh]',
            // Desktop anchored dropdown — reset the fixed positioning
            'sm:absolute sm:inset-auto sm:right-0 sm:bottom-auto sm:mt-1 sm:w-64 sm:rounded-lg sm:max-h-none'
          )}>
            {/* Mobile-only sheet header with a close button */}
            <div className="sm:hidden flex items-center justify-between px-4 py-3 border-b border-border sticky top-0 bg-card">
              <span className="text-white font-bold text-sm">Select Pair</span>
              <button type="button" onClick={() => setOpen(false)} className="text-text-secondary hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            {options}
          </div>
        </>
      )}
    </div>
  );
}
