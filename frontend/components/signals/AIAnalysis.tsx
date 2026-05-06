'use client';
import { AIAnalysis as AIAnalysisType } from '@/types';
import { Brain, RefreshCw, AlertTriangle, CheckCircle, Clock, Lightbulb } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

interface AIAnalysisProps {
  analysis?: AIAnalysisType | null;
  loading?: boolean;
  onRefresh?: () => void;
}

export default function AIAnalysis({ analysis, loading, onRefresh }: AIAnalysisProps) {
  if (loading) {
    return (
      <div className="bg-card border border-border rounded-xl p-6">
        <div className="flex items-center gap-3 mb-6">
          <Brain className="w-5 h-5 text-accent animate-pulse" />
          <span className="text-white font-medium">Analyzing market...</span>
        </div>
        <div className="space-y-3">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="animate-pulse">
              <div className="h-3 bg-border rounded w-24 mb-2" />
              <div className="h-4 bg-border rounded" />
              <div className="h-4 bg-border rounded w-4/5 mt-1" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!analysis) return null;

  const sections = [
    { label: 'Market Summary', content: analysis.summary, icon: Brain, color: 'text-accent' },
    { label: 'Signal Reasoning', content: analysis.reasoning, icon: Lightbulb, color: 'text-yellow-400' },
    { label: 'Key Risks', content: analysis.risks, icon: AlertTriangle, color: 'text-danger' },
    { label: 'Recommendation', content: analysis.recommendation, icon: CheckCircle, color: 'text-success' },
    { label: 'Session Advice', content: analysis.session_advice, icon: Clock, color: 'text-text-secondary' }
  ];

  return (
    <div className="bg-card border border-border rounded-xl p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-accent" />
          <h3 className="text-white font-medium">AI Analysis</h3>
          {analysis.model && (
            <span className="text-xs text-text-secondary bg-border px-2 py-0.5 rounded-full">
              {analysis.model}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {analysis.generated_at && (
            <span className="text-text-secondary text-xs">
              {format(new Date(analysis.generated_at), 'HH:mm')}
            </span>
          )}
          <button
            onClick={onRefresh}
            className="flex items-center gap-1.5 text-accent text-sm hover:underline"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {sections.map(({ label, content, icon: Icon, color }) => (
          <div key={label} className="border-l-2 border-border pl-4">
            <div className={cn('flex items-center gap-1.5 text-xs font-semibold mb-1 uppercase tracking-wide', color)}>
              <Icon className="w-3.5 h-3.5" />
              {label}
            </div>
            <p className="text-text-secondary text-sm leading-relaxed">{content}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
