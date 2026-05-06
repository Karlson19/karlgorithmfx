'use client';
import { cn } from '@/lib/utils';

interface ConfidenceBarProps {
  confidence: number;
  agreeing: number;
  total: number;
}

export default function ConfidenceBar({ confidence, agreeing, total }: ConfidenceBarProps) {
  const label = confidence >= 80 ? 'STRONG' : confidence >= 70 ? 'MODERATE' : confidence >= 60 ? 'WEAK' : 'NO SIGNAL';
  const color = confidence >= 80 ? 'bg-success' : confidence >= 70 ? 'bg-accent' : confidence >= 60 ? 'bg-yellow-400' : 'bg-zinc-600';

  return (
    <div className="bg-card border border-border rounded-xl p-6">
      <h3 className="text-white font-medium mb-4">Signal Confidence</h3>
      <div className="flex justify-between items-center mb-3">
        <span className={cn('text-4xl font-bold font-mono',
          confidence >= 80 ? 'text-success' : confidence >= 70 ? 'text-accent' : 'text-yellow-400'
        )}>{confidence}%</span>
        <span className={cn('text-sm font-bold px-3 py-1 rounded border',
          confidence >= 80 ? 'text-success border-success/30 bg-success/10' :
          confidence >= 70 ? 'text-accent border-accent/30 bg-accent/10' :
          'text-yellow-400 border-yellow-400/30 bg-yellow-400/10'
        )}>{label}</span>
      </div>
      <div className="h-4 bg-border rounded-full overflow-hidden mb-3">
        <div className={cn('h-full rounded-full transition-all duration-700', color)} style={{ width: `${confidence}%` }} />
      </div>
      <p className="text-text-secondary text-sm">
        <span className="text-white font-semibold">{agreeing}</span> of <span className="text-white font-semibold">{total}</span> indicators confirm this signal
      </p>
    </div>
  );
}
