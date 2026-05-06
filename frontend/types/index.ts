export interface PriceData {
  price: number;
  bid: number;
  ask: number;
  spread: number;
  change: number;
  change_percent: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
  timestamp: string;
  source?: string;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export type SignalDirection = 'BUY' | 'SELL' | 'NEUTRAL';
export type MarketCondition = 'TRENDING' | 'RANGING' | 'VOLATILE';

export interface Signal {
  direction: SignalDirection;
  entry: number;
  stop_loss: number | null;
  take_profit_1: number | null;
  take_profit_2: number | null;
  confidence: number;
  strategy: string;
  market_condition: MarketCondition;
  timeframe: string;
  risk_reward: string | null;
  atr_pips?: number;
  mtf?: MTFResult;
  timestamp: string;
  indicators_agreeing: number;
  total_indicators: number;
  agreeing_indicators?: string[];
}

export interface IndicatorResult {
  value: number;
  signal: 'BUY' | 'SELL' | 'NEUTRAL';
  description?: string;
}

export interface MACDResult {
  value: number;
  signal: 'BUY' | 'SELL' | 'NEUTRAL';
  histogram: number;
  signal_line: number;
}

export interface BollingerResult {
  upper: number;
  middle: number;
  lower: number;
  signal: 'BUY' | 'SELL' | 'NEUTRAL';
  width: number;
}

export interface ADXResult {
  value: number;
  trending: boolean;
  strong: boolean;
}

export interface StochasticResult {
  k: number;
  d: number;
  signal: 'BUY' | 'SELL' | 'NEUTRAL';
}

export interface FibonacciResult {
  swing_high: number;
  swing_low: number;
  levels: Record<string, number>;
}

export interface SupportResistanceResult {
  resistance: number[];
  support: number[];
}

export interface ATRResult {
  value: number;
  pips: number;
}

export interface IchimokuResult {
  tenkan: number;
  kijun: number;
  span_a: number;
  span_b: number;
  signal: 'BUY' | 'SELL' | 'NEUTRAL';
  cloud_position: 'ABOVE' | 'BELOW' | 'INSIDE';
  description: string;
}

export interface CandlePatternResult {
  bullish: string[];
  bearish: string[];
  doji: boolean;
  signal: 'BUY' | 'SELL' | 'NEUTRAL';
}

export interface PivotPoints {
  pp: number;
  r1: number; r2: number; r3: number;
  s1: number; s2: number; s3: number;
}

export interface MTFResult {
  h4_bias: 'BUY' | 'SELL' | 'NEUTRAL';
  h1_bias: 'BUY' | 'SELL' | 'NEUTRAL';
  m15_bias: 'BUY' | 'SELL' | 'NEUTRAL';
  aligned: boolean;
  description: string;
}

export interface Indicators {
  rsi: IndicatorResult;
  macd: MACDResult;
  ema20: IndicatorResult;
  ema50: IndicatorResult;
  ema200: IndicatorResult;
  bollinger: BollingerResult;
  adx: ADXResult;
  stochastic: StochasticResult;
  atr: ATRResult;
  williamsR: IndicatorResult;
  cci: IndicatorResult;
  ichimoku: IchimokuResult;
  candlePatterns: CandlePatternResult;
  fibonacci: FibonacciResult;
  support_resistance: SupportResistanceResult;
  pivot_points: PivotPoints | null;
  market_condition: MarketCondition;
  mtf: MTFResult;
  timestamp: string;
}

export interface AIAnalysis {
  summary: string;
  reasoning: string;
  risks: string;
  recommendation: string;
  session_advice: string;
  generated_at: string;
  model?: string;
}

export type TradeDirection = 'BUY' | 'SELL';
export type TradeStatus = 'open' | 'closed';

export interface Trade {
  id: string;
  user_id: string;
  pair: string;
  direction: TradeDirection;
  lot_size: number;
  entry_price: number;
  stop_loss: number | null;
  take_profit: number | null;
  close_price: number | null;
  profit_loss: number | null;
  status: TradeStatus;
  strategy: string | null;
  notes: string | null;
  opened_at: string;
  closed_at: string | null;
  created_at: string;
}

export interface TradeStats {
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number;
  total_profit: number;
  average_profit: number;
  average_loss: number;
  profit_factor: number | string;
  best_trade: number;
  worst_trade: number;
  current_streak: number;
}

export type ImpactLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export interface NewsItem {
  id: string;
  title: string;
  currency: 'EUR' | 'USD' | 'OTHER';
  date: string;
  impact: ImpactLevel;
  forecast: string | null;
  previous: string | null;
  actual: string | null;
  countdown: string;
  link?: string;
  snippet?: string;
}

export interface SessionInfo {
  active_session: string;
  all_active: string[];
  good_time_to_trade: boolean;
  is_peak_hours: boolean;
  next_session: string;
  next_session_in: string;
  sessions: Record<string, boolean>;
}

export interface WSMessage {
  type: 'PRICE_UPDATE' | 'SIGNAL_UPDATE' | 'SESSION_UPDATE' | 'PONG';
  data: PriceData | Signal | SessionInfo;
}
