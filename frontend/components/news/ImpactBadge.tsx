'use client';
import { ImpactLevel } from '@/types';
import { cn, getImpactColor, getImpactDot } from '@/lib/utils';

export default function ImpactBadge({ impact }: { impact: ImpactLevel }) {
  return (
    <span className={cn('inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-semibold', getImpactColor(impact))}>
      <span className={cn('w-1.5 h-1.5 rounded-full', getImpactDot(impact))} />
      {impact}
    </span>
  );
}
