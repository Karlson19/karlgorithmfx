'use client';
import { NewsItem } from '@/types';
import { getImpactColor, getImpactDot, cn } from '@/lib/utils';
import { Clock, ExternalLink } from 'lucide-react';
import { format, isToday } from 'date-fns';

export default function NewsCard({ item }: { item: NewsItem }) {
  const date = new Date(item.date);
  const isPast = date < new Date();

  return (
    <div className={cn(
      'bg-card border rounded-xl p-4 transition-colors',
      isToday(date) ? 'border-accent/30' : 'border-border'
    )}>
      <div className="flex items-start gap-3">
        {/* Currency flag — covers every currency we trade across all pairs */}
        <div className="flex-shrink-0 w-10 h-10 rounded-full bg-background border border-border flex items-center justify-center text-lg">
          {(({
            EUR: '🇪🇺',
            USD: '🇺🇸',
            GBP: '🇬🇧',
            JPY: '🇯🇵',
            AUD: '🇦🇺',
            OTHER: '🌐',
          } as Record<string, string>)[item.currency] || '🌐')}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-1">
            <h4 className="text-white text-sm font-medium truncate">{item.title}</h4>
            {item.link && (
              <a href={item.link} target="_blank" rel="noopener noreferrer" className="text-text-secondary hover:text-white flex-shrink-0">
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>

          <div className="flex items-center gap-3 flex-wrap text-xs text-text-secondary">
            <div className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {format(date, 'MMM d, HH:mm')}
              {isToday(date) && <span className="text-accent">(Today)</span>}
            </div>
            <span className={cn('px-2 py-0.5 rounded-full border font-semibold flex items-center gap-1', getImpactColor(item.impact))}>
              <span className={cn('w-1.5 h-1.5 rounded-full', getImpactDot(item.impact))} />
              {item.impact}
            </span>
            <span className="text-text-secondary">{item.currency}</span>
          </div>

          {/* Forecast/Previous/Actual */}
          {(item.forecast || item.previous || item.actual) && (
            <div className="flex gap-4 mt-2 text-xs font-mono">
              {item.forecast && (
                <div><span className="text-text-secondary">Forecast </span><span className="text-white">{item.forecast}</span></div>
              )}
              {item.previous && (
                <div><span className="text-text-secondary">Previous </span><span className="text-white">{item.previous}</span></div>
              )}
              {item.actual && (
                <div><span className="text-text-secondary">Actual </span><span className={cn('font-bold',
                  item.actual > item.forecast! ? 'text-success' : 'text-danger'
                )}>{item.actual}</span></div>
              )}
            </div>
          )}

          {!isPast && (
            <div className="mt-2 text-xs">
              <span className="text-text-secondary">In </span>
              <span className="text-accent font-semibold">{item.countdown}</span>
            </div>
          )}

          {item.snippet && (
            <p className="text-text-secondary text-xs mt-2 line-clamp-2">{item.snippet}</p>
          )}
        </div>
      </div>
    </div>
  );
}
