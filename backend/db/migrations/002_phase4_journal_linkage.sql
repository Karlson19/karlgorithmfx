-- ────────────────────────────────────────────────────────────────────────────
-- Migration 002 (Phase 4): journal multi-pair fix + signal linkage.
--
-- Run in Supabase SQL Editor. Idempotent — safe to re-run.
--
-- Changes:
--   1) trades.pair: ensure column exists, backfill 'EUR/USD' for old rows,
--      make NOT NULL. Without this, multi-pair trade logging is silently
--      broken (every trade got tagged 'EURUSD' by the old backend).
--   2) trades.signal_id: nullable FK-style column. When a trade is opened
--      from a signal, we record the signal it came from. Enables
--      "this signal led to this outcome" analytics later.
--   3) signals.fired_strategy_name: persist the named strategy that
--      produced the signal so we can compute per-strategy win rates
--      from history. Backfilled from the legacy `strategy` text field.
-- ────────────────────────────────────────────────────────────────────────────

-- 1) trades.pair
ALTER TABLE trades ADD COLUMN IF NOT EXISTS pair TEXT;

-- Backfill legacy rows. The old backend hardcoded 'EURUSD' (no slash) so
-- catch both stylings.
UPDATE trades SET pair = 'EUR/USD'
 WHERE pair IS NULL OR pair = 'EURUSD' OR pair = '';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'trades' AND column_name = 'pair' AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE trades ALTER COLUMN pair SET NOT NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS trades_pair_user_idx ON trades (user_id, pair, opened_at DESC);

-- 2) trades.signal_id (no FK constraint — signals table is in a different
-- ownership model; we just keep the UUID string for lookups)
ALTER TABLE trades ADD COLUMN IF NOT EXISTS signal_id UUID;
CREATE INDEX IF NOT EXISTS trades_signal_id_idx ON trades (signal_id);

-- 3) signals.fired_strategy_name
ALTER TABLE signals ADD COLUMN IF NOT EXISTS fired_strategy_name TEXT;

-- Best-effort backfill from the existing `strategy` text column. We extract
-- the first recognizable strategy name. Rows that pre-date the strategy
-- engine just stay NULL — that's correct.
UPDATE signals
   SET fired_strategy_name = (
     CASE
       WHEN strategy LIKE 'EMA Pullback%'           THEN 'EMA Pullback'
       WHEN strategy LIKE 'Asian Range Breakout%'   THEN 'Asian Range Breakout'
       WHEN strategy LIKE 'Bollinger Squeeze%'      THEN 'Bollinger Squeeze Breakout'
       WHEN strategy LIKE 'S/R Mean Reversion%'     THEN 'S/R Mean Reversion'
       WHEN strategy LIKE 'Liquidity Sweep%'        THEN 'Liquidity Sweep Reversal'
       WHEN strategy LIKE 'MTF Confluence%'         THEN 'MTF Confluence'
       WHEN strategy LIKE 'Pivot Reaction%'         THEN 'Pivot Reaction'
       WHEN strategy LIKE 'News Fade%'              THEN 'News Fade'
       ELSE NULL
     END
   )
 WHERE fired_strategy_name IS NULL AND strategy IS NOT NULL;

CREATE INDEX IF NOT EXISTS signals_strategy_pair_idx
  ON signals (fired_strategy_name, symbol, created_at DESC);

-- Verification queries (uncomment to inspect after running):
-- SELECT pair, COUNT(*) FROM trades GROUP BY pair ORDER BY 2 DESC;
-- SELECT fired_strategy_name, COUNT(*) FROM signals
--   WHERE fired_strategy_name IS NOT NULL GROUP BY 1 ORDER BY 2 DESC;
