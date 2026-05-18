-- ────────────────────────────────────────────────────────────────────────────
-- Migration 001: add `symbol` column to the `signals` table.
--
-- Run in the Supabase SQL Editor (Dashboard → SQL → New Query → paste → Run).
-- Safe to re-run: every statement is idempotent.
--
-- After this migration:
--   - All NEW signals are persisted with the symbol they were generated for
--   - All EXISTING rows are backfilled to 'EUR/USD' (the previous default)
--   - Per-pair queries become efficient (the new index)
-- ────────────────────────────────────────────────────────────────────────────

-- 1) Add the column (nullable to support backfill in one go).
ALTER TABLE signals
  ADD COLUMN IF NOT EXISTS symbol TEXT;

-- 2) Backfill historical rows. Everything previously persisted was EUR/USD.
UPDATE signals
   SET symbol = 'EUR/USD'
 WHERE symbol IS NULL;

-- 3) Make the column required for new inserts. (Skip if already not null.)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'signals' AND column_name = 'symbol' AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE signals ALTER COLUMN symbol SET NOT NULL;
  END IF;
END $$;

-- 4) Index for per-pair history & stats queries.
CREATE INDEX IF NOT EXISTS signals_symbol_created_at_idx
  ON signals (symbol, created_at DESC);

-- 5) Optional sanity check (uncomment to verify after running):
-- SELECT symbol, COUNT(*) FROM signals GROUP BY symbol ORDER BY 2 DESC;
