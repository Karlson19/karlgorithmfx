import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatPrice(price: number | null | undefined, decimals = 5): string {
  if (price == null) return '—';
  return price.toFixed(decimals);
}

export function formatPips(pips: number): string {
  return (pips >= 0 ? '+' : '') + pips.toFixed(1);
}

export function formatPercent(value: number): string {
  return (value >= 0 ? '+' : '') + value.toFixed(2) + '%';
}

export function formatCurrency(value: number | null | undefined): string {
  if (value == null) return '—';
  return (value >= 0 ? '+$' : '-$') + Math.abs(value).toFixed(2);
}

export function getSignalColor(signal: string): string {
  if (signal === 'BUY') return 'text-success';
  if (signal === 'SELL') return 'text-danger';
  return 'text-text-secondary';
}

export function getSignalBg(signal: string): string {
  if (signal === 'BUY') return 'bg-success/10 text-success border-success/30';
  if (signal === 'SELL') return 'bg-danger/10 text-danger border-danger/30';
  return 'bg-zinc-800 text-text-secondary border-border';
}

export function getImpactColor(impact: string): string {
  if (impact === 'HIGH') return 'text-danger bg-danger/10 border-danger/30';
  if (impact === 'MEDIUM') return 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30';
  return 'text-success bg-success/10 border-success/30';
}

export function getImpactDot(impact: string): string {
  if (impact === 'HIGH') return 'bg-danger';
  if (impact === 'MEDIUM') return 'bg-yellow-400';
  return 'bg-success';
}
