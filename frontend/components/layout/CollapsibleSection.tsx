'use client';
import { ReactNode, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CollapsibleSectionProps {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  storageKey?: string;        // when provided, open/closed state persists across reloads
  rightSlot?: ReactNode;      // optional header-right content (badges, counts, etc.)
  children: ReactNode;
}

// Collapsible card with a click-to-fold header. Used to keep the signals page
// from becoming a wall of panels — users can collapse what they don't need
// at the moment. Optional `storageKey` persists the open/closed state via
// localStorage so the user's layout sticks across reloads.
export default function CollapsibleSection({
  title,
  subtitle,
  defaultOpen = true,
  storageKey,
  rightSlot,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(() => {
    if (typeof window === 'undefined' || !storageKey) return defaultOpen;
    const stored = window.localStorage.getItem(`collapse:${storageKey}`);
    if (stored === null) return defaultOpen;
    return stored === '1';
  });

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (storageKey && typeof window !== 'undefined') {
      window.localStorage.setItem(`collapse:${storageKey}`, next ? '1' : '0');
    }
  };

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={toggle}
        className="w-full flex items-center justify-between gap-3 px-5 py-3 hover:bg-background/30 transition-colors"
      >
        <div className="text-left">
          <h3 className="text-white font-bold text-sm">{title}</h3>
          {subtitle && <p className="text-text-secondary text-xs mt-0.5">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2">
          {rightSlot}
          <ChevronDown className={cn('w-4 h-4 text-text-secondary transition-transform', !open && '-rotate-90')} />
        </div>
      </button>
      {open && <div className="border-t border-border">{children}</div>}
    </div>
  );
}
