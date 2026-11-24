-- ────────────────────────────────────────────────────────────────────────────
-- Migration 004: shadow_signals table.
--
-- Run in the Supabase SQL Editor. Idempotent — safe to re-run.
-- Run it BEFORE deploying the code that uses it (the code also tolerates the
-- table being missing: shadow tracking is simply skipped until it exists).
--
-- Shadow signals are setups that the calibration gate BLOCKED. They are
-- tracked (outcomes evaluated like real signals) but never shown to users or
-- alerted. They let a blocked confidence band keep collecting data, so one
-- unlucky streak cannot lock a band out forever.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS shadow_signals (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  symbol              TEXT NOT NULL,
  direction           TEXT NOT NULL,
  entry               NUMERIC,
  stop_loss           NUMERIC,
  take_profit_1       NUMERIC,
  take_profit_2       NUMERIC,
  confidence          NUMERIC,
  strategy            TEXT,
  fired_strategy_name TEXT,
  market_condition    TEXT,
  timeframe           TEXT,
  risk_reward         TEXT,
  indicators_agreeing INTEGER,
  total_indicators    INTEGER,
  outcome             TEXT,
  outcome_price       NUMERIC,
  outcome_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS shadow_signals_symbol_created_at_idx
  ON shadow_signals (symbol, created_at DESC);

-- SECURITY: the backend uses the service key (bypasses RLS). Enabling RLS with
-- no policies blocks the public anon key from reading or writing this table.
ALTER TABLE shadow_signals ENABLE ROW LEVEL SECURITY;
