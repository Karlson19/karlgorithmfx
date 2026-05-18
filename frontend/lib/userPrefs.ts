// ─── User preferences (localStorage-backed) ──────────────────────────────────
// These are user-specific, client-only values that don't need to round-trip
// to the backend: account balance for the risk calculator, default risk %,
// preferred default pair, etc.
//
// We persist them to localStorage so the risk calculator + trade form pre-fill
// with the user's actual numbers instead of the hardcoded $10k @ 1% defaults.
//
// Server-side persistence is overkill — this is per-device anyway, and
// nothing here is sensitive.

const STORAGE_KEY = 'karlfx:userPrefs';

export interface UserPrefs {
  account_balance: number;
  default_risk_pct: number;
  default_symbol: string;
}

const DEFAULTS: UserPrefs = {
  account_balance: 10000,
  default_risk_pct: 1.0,
  default_symbol: 'EUR/USD',
};

export function getUserPrefs(): UserPrefs {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw);
    return {
      account_balance: typeof parsed.account_balance === 'number' && parsed.account_balance > 0
        ? parsed.account_balance : DEFAULTS.account_balance,
      default_risk_pct: typeof parsed.default_risk_pct === 'number' && parsed.default_risk_pct > 0 && parsed.default_risk_pct <= 10
        ? parsed.default_risk_pct : DEFAULTS.default_risk_pct,
      default_symbol: typeof parsed.default_symbol === 'string' ? parsed.default_symbol : DEFAULTS.default_symbol,
    };
  } catch {
    return DEFAULTS;
  }
}

export function setUserPrefs(prefs: Partial<UserPrefs>): UserPrefs {
  if (typeof window === 'undefined') return DEFAULTS;
  const current = getUserPrefs();
  const merged = { ...current, ...prefs };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    // Broadcast so other open tabs / components react.
    window.dispatchEvent(new CustomEvent('userPrefsChange', { detail: merged }));
  } catch {}
  return merged;
}
