const newsService = require('./newsService');
const { PAIRS, listEnabledSymbols } = require('../config/pairs');

// ─── Market Focus Service ────────────────────────────────────────────────────
// Real-time situational awareness:
//   - What session is active right now? How long until it ends?
//   - Which pairs are LIVE in this session (per session_weights config)?
//   - Which pairs should be SIDELINED (low liquidity for this session)?
//   - What's the next session and when does it start?
//   - What HIGH-impact news events are coming up that might disrupt things?
//   - What's the recommended market PHASE (peak liquidity, range-build,
//     news-watch, dead-zone, etc.)?
//
// This is read by the orchestrator (to bias opportunity scores) AND
// surfaced to the UI as a "Market Focus" widget so the trader knows what
// to watch RIGHT NOW.

// Session windows in UTC.
// Each entry: { label, start_hour (inclusive), end_hour (exclusive), phase }
const SESSIONS = [
  { label: 'ASIAN',             start: 23, end: 7,  wrap: true,  phase: 'RANGE_BUILD' },
  { label: 'LONDON',            start: 7,  end: 12, phase: 'TREND_FORMATION' },
  { label: 'LONDON_NY_OVERLAP', start: 12, end: 16, phase: 'PEAK_LIQUIDITY' },
  { label: 'NEW_YORK',          start: 16, end: 21, phase: 'AFTERNOON_DRIFT' },
  { label: 'DEAD_ZONE',         start: 21, end: 23, phase: 'AVOID' },
];

function currentSession(utcHour) {
  for (const s of SESSIONS) {
    if (s.wrap) {
      // Wrapping range (e.g., ASIAN 23 → 07)
      if (utcHour >= s.start || utcHour < s.end) return s;
    } else {
      if (utcHour >= s.start && utcHour < s.end) return s;
    }
  }
  return SESSIONS[0]; // fallback
}

function nextSessionAfter(currentLabel) {
  const idx = SESSIONS.findIndex(s => s.label === currentLabel);
  if (idx < 0) return SESSIONS[0];
  return SESSIONS[(idx + 1) % SESSIONS.length];
}

// How many minutes until the next session change?
function minutesUntilSessionEnd(session, now) {
  const utcHour = now.getUTCHours();
  const utcMin  = now.getUTCMinutes();
  const nowMin  = utcHour * 60 + utcMin;

  let endMin;
  if (session.wrap) {
    // wrap session ends at session.end the next morning
    if (utcHour >= session.start) endMin = (24 + session.end) * 60;
    else                          endMin = session.end * 60;
  } else {
    endMin = session.end * 60;
  }
  return Math.max(0, endMin - nowMin);
}

// Categorise a pair's relevance in the current session.
function pairRelevance(pair, sessionLabel) {
  const w = pair.session_weights[sessionLabel];
  if (w == null) return { live: true, weight: 0.5, tier: 'neutral' };
  if (w >= 0.9) return { live: true,  weight: w, tier: 'live' };
  if (w >= 0.6) return { live: true,  weight: w, tier: 'active' };
  if (w >= 0.4) return { live: false, weight: w, tier: 'quiet' };
  return            { live: false, weight: w, tier: 'sidelined' };
}

// Map of session phase → which named strategies fit best.
const PHASE_STRATEGIES = {
  RANGE_BUILD: ['S/R Mean Reversion', 'Liquidity Sweep Reversal'],
  TREND_FORMATION: ['Asian Range Breakout', 'MTF Confluence', 'EMA Pullback'],
  PEAK_LIQUIDITY: ['EMA Pullback', 'MTF Confluence', 'Bollinger Squeeze Breakout', 'Pivot Reaction'],
  AFTERNOON_DRIFT: ['EMA Pullback', 'Pivot Reaction', 'S/R Mean Reversion'],
  AVOID: [],
};

// Pull the next upcoming HIGH-impact news event(s) per currency. Used by the
// UI to warn "USD news in 27 min — careful on USD pairs."
function upcomingNews(news) {
  const now = Date.now();
  return (news || [])
    .filter(n => n.impact === 'HIGH')
    .map(n => ({
      ...n,
      minutes_away: Math.round((new Date(n.date).getTime() - now) / 60000),
    }))
    .filter(n => n.minutes_away > 0 && n.minutes_away < 240) // within 4h
    .sort((a, b) => a.minutes_away - b.minutes_away);
}

// Which pairs are affected by upcoming HIGH news?
function pairsAffectedByNews(upcoming) {
  const affected = {};
  for (const n of upcoming.slice(0, 5)) {
    for (const sym of listEnabledSymbols()) {
      const pair = PAIRS[sym];
      if (pair.news_currencies.includes(n.currency)) {
        if (!affected[sym] || affected[sym].minutes_away > n.minutes_away) {
          affected[sym] = {
            title: n.title,
            currency: n.currency,
            minutes_away: n.minutes_away,
          };
        }
      }
    }
  }
  return affected;
}

async function getMarketFocus() {
  const now = new Date();
  const utcHour = now.getUTCHours();
  const session = currentSession(utcHour);
  const next = nextSessionAfter(session.label);
  const minutesToNext = minutesUntilSessionEnd(session, now);

  // Pair relevance for the current session
  const pair_relevance = {};
  for (const sym of listEnabledSymbols()) {
    pair_relevance[sym] = pairRelevance(PAIRS[sym], session.label);
  }
  const recommended_pairs = Object.entries(pair_relevance)
    .filter(([, r]) => r.tier === 'live')
    .map(([s]) => s);
  const active_pairs = Object.entries(pair_relevance)
    .filter(([, r]) => r.tier === 'active')
    .map(([s]) => s);
  const sidelined_pairs = Object.entries(pair_relevance)
    .filter(([, r]) => r.tier === 'sidelined' || r.tier === 'quiet')
    .map(([s]) => s);

  // News awareness
  let news = [];
  try { news = await newsService.fetchNews(); } catch {}
  const upcoming = upcomingNews(news);
  const news_affected_pairs = pairsAffectedByNews(upcoming);

  return {
    timestamp: now.toISOString(),
    utc_hour: utcHour,
    utc_time: now.toISOString().slice(11, 16),
    current_session: {
      label: session.label,
      phase: session.phase,
      minutes_remaining: minutesToNext,
    },
    next_session: {
      label: next.label,
      phase: next.phase,
      minutes_until: minutesToNext,
    },
    recommended_pairs,
    active_pairs,
    sidelined_pairs,
    pair_relevance,
    suggested_strategies: PHASE_STRATEGIES[session.phase] || [],
    upcoming_news: upcoming.slice(0, 5),
    news_affected_pairs,
    market_phase: session.phase,
  };
}

module.exports = { getMarketFocus };
