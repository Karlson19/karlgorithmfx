-- ────────────────────────────────────────────────────────────────────────────
-- Migration 003: push_subscriptions table for Web Push notifications.
--
-- Run in Supabase SQL Editor. Idempotent.
--
-- Stores each device's push subscription so the backend can send background
-- notifications (gold reversal at 00:30, etc.) even when the PWA is closed.
-- A user can have several rows (phone + laptop). Keyed by endpoint.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL UNIQUE,
  p256dh      TEXT,
  auth        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON push_subscriptions (user_id);

-- RLS: users manage only their own subscriptions. The backend uses the
-- service-role key which bypasses RLS for the cron sender.
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own push subs"   ON push_subscriptions;
DROP POLICY IF EXISTS "Users insert own push subs" ON push_subscriptions;
DROP POLICY IF EXISTS "Users update own push subs" ON push_subscriptions;
DROP POLICY IF EXISTS "Users delete own push subs" ON push_subscriptions;

CREATE POLICY "Users read own push subs"   ON push_subscriptions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own push subs" ON push_subscriptions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own push subs" ON push_subscriptions FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own push subs" ON push_subscriptions FOR DELETE USING (auth.uid() = user_id);
