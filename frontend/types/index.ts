export interface PriceData {
  symbol?: string;
  display_name?: string;
  price: number;
  // Bid/ask are null on free data tiers (Twelve Data /quote doesn't expose
  // them). UI should hide or label-as-unknown when null instead of inventing
  // values.
  bid: number | null;
  ask: number | null;
  spread_pips: number | null;
  spread_estimated?: boolean;
  typical_spread?: number;
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

export interface CalibrationInfo {
  calibrated: boolean;
  band: number;
  sample_size: number;
  win_rate?: number;
}

export interface NewsBlackoutInfo {
  title: string;
  currency: string;
  minutes: number;
}

// One condition in a strategy's checklist.
export interface StrategyCondition {
  name: string;
  met: boolean;
  weight: number;
  required?: boolean;
}

// A strategy that fully fired and produced this signal.
export interface FiredStrategy {
  name: string;
  description: string;
  confidence: number;
  conditions: StrategyCondition[];
  context?: Record<string, unknown>;
}

// A strategy that's almost ready — surfaced in the watchlist.
export interface WatchlistItem {
  symbol?: string;
  display_name?: string;
  name: string;
  description: string;
  direction: 'BUY' | 'SELL' | null;
  completion_pct: number;
  conditions: StrategyCondition[];
}

// Real-time market context — sessions, news, recommended pairs.
export interface MarketFocus {
  timestamp: string;
  utc_hour: number;
  utc_time: string;
  current_session: { label: string; phase: string; minutes_remaining: number };
  next_session: { label: string; phase: string; minutes_until: number };
  recommended_pairs: string[];
  active_pairs: string[];
  sidelined_pairs: string[];
  pair_relevance: Record<string, { live: boolean; weight: number; tier: string }>;
  suggested_strategies: string[];
  upcoming_news: Array<{ title: string; currency: string; minutes_away: number; impact: string }>;
  news_affected_pairs: Record<string, { title: string; currency: string; minutes_away: number }>;
  market_phase: string;
}

export interface Signal {
  symbol?: string;
  display_name?: string;
  direction: SignalDirection;
  entry: number;
  stop_loss: number | null;
  take_profit_1: number | null;
  take_profit_2: number | null;
  confidence: number;
  strategy: string;
  fired_strategy?: FiredStrategy | null;
  additional_strategies?: Array<{ name: string; direction: SignalDirection; confidence: number }>;
  watchlist?: WatchlistItem[];
  strategies_fired?: number;
  market_condition: MarketCondition;
  timeframe: string;
  risk_reward: string | null;
  atr_pips?: number | null;
  mtf?: MTFResult;
  session?: string;
  news_blackout?: NewsBlackoutInfo | null;
  calibration?: CalibrationInfo;
  timestamp: string;
  indicators_agreeing: number;
  total_indicators: number;
  agreeing_indicators?: string[];
  abstentions?: string[];
  margin_ratio?: number;
  opportunity_score?: number;
}

export interface SignalsAllResponse {
  market_focus?: MarketFocus | null;
  signals: Record<string, Signal>;
  ranked: Signal[];
  errors: Record<string, string>;
  generated_at: string;
  best_opportunity: Signal | null;
}

// All indicator results now carry an `available` flag. When false, numeric
// values are null and `signal` is 'NEUTRAL'. UIs should treat unavailable
// indicators as "no data" instead of rendering a fake number.
export interface IndicatorResult {
  available: boolean;
  value: number | null;
  signal: 'BUY' | 'SELL' | 'NEUTRAL';
  description?: string;
}

export interface MACDResult {
  available: boolean;
  value: number;
  signal: 'BUY' | 'SELL' | 'NEUTRAL';
  histogram: number;
  signal_line: number;
}

export interface BollingerResult {
  available: boolean;
  upper: number | null;
  middle: number | null;
  lower: number | null;
  signal: 'BUY' | 'SELL' | 'NEUTRAL';
  width: number | null;
  width_pct?: number | null;
}

export interface ADXResult {
  available: boolean;
  value: number | null;
  trending: boolean;
  strong: boolean;
}

export interface StochasticResult {
  available: boolean;
  k: number | null;
  d: number | null;
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
  available: boolean;
  value: number | null;
  pips: number | null;
}

export interface IchimokuResult {
  available: boolean;
  tenkan: number | null;
  kijun: number | null;
  span_a: number | null;
  span_b: number | null;
  signal: 'BUY' | 'SELL' | 'NEUTRAL';
  cloud_position: 'ABOVE' | 'BELOW' | 'INSIDE' | 'UNKNOWN';
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
  basis?: string;
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
  reference_price?: number;
  candle_time?: number;
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

export type SignalOutcome = 'WIN_TP1' | 'WIN_TP2' | 'LOSS' | 'EXPIRED';

export interface StoredSignal {
  id: string;
  symbol?: string;
  direction: SignalDirection;
  entry: number;
  stop_loss: number | null;
  take_profit_1: number | null;
  take_profit_2: number | null;
  confidence: number;
  strategy: string | null;
  market_condition: MarketCondition | null;
  timeframe: string;
  risk_reward: string | null;
  indicators_agreeing: number;
  total_indicators: number;
  outcome: SignalOutcome | null;
  outcome_price: number | null;
  outcome_at: string | null;
  created_at: string;
}

export interface SignalStats {
  total: number;
  wins: number;
  losses: number;
  win_rate: number;
  avg_confidence: number;
  win_confidence: number;
  loss_confidence: number;
  buy_win_rate: number;
  sell_win_rate: number;
  per_pair?: Record<string, SignalStats>;
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
  type: 'PRICE_UPDATE' | 'SIGNAL_UPDATE' | 'SIGNALS_ALL_UPDATE' | 'SESSION_UPDATE' | 'PONG';
  data: PriceData | Signal | SignalsAllResponse | SessionInfo;
}
