import axios from 'axios';
import { supabase } from './supabase';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

async function getAuthHeader() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}

// Every market endpoint accepts an optional `symbol` param. When omitted,
// the backend falls back to PRIMARY_SYMBOL (EUR/USD).
const api = {
  // ── Pairs ──────────────────────────────────────────────────────────────────
  async getPairs() {
    const res = await axios.get(`${BASE_URL}/api/price/pairs`);
    return res.data;
  },

  // ── Price ──────────────────────────────────────────────────────────────────
  async getPrice(symbol?: string) {
    const res = await axios.get(`${BASE_URL}/api/price/live`, { params: symbol ? { symbol } : {} });
    return res.data;
  },

  async getAllPrices() {
    const res = await axios.get(`${BASE_URL}/api/price/live/all`);
    return res.data;
  },

  async getHistory(interval = '1h', outputsize = 200, symbol?: string) {
    const res = await axios.get(`${BASE_URL}/api/price/history`, {
      params: { interval, outputsize, ...(symbol ? { symbol } : {}) },
    });
    return res.data;
  },

  // ── Indicators ─────────────────────────────────────────────────────────────
  async getIndicators(interval = '1h', symbol?: string) {
    const res = await axios.get(`${BASE_URL}/api/indicators`, {
      params: { interval, ...(symbol ? { symbol } : {}) },
    });
    return res.data;
  },

  // ── Signals ────────────────────────────────────────────────────────────────
  async getSignal(symbol?: string) {
    const res = await axios.get(`${BASE_URL}/api/signals`, { params: symbol ? { symbol } : {} });
    return res.data;
  },

  async getAllSignals() {
    const res = await axios.get(`${BASE_URL}/api/signals/all`);
    return res.data;
  },

  async refreshSignal(symbol?: string) {
    const res = await axios.post(`${BASE_URL}/api/signals/refresh`, null, {
      params: symbol ? { symbol } : {},
    });
    return res.data;
  },

  async refreshAllSignals() {
    const res = await axios.post(`${BASE_URL}/api/signals/refresh/all`);
    return res.data;
  },

  async getSignalHistory(limit = 50, symbol?: string) {
    const res = await axios.get(`${BASE_URL}/api/signals/history`, {
      params: { limit, ...(symbol ? { symbol } : {}) },
    });
    return res.data;
  },

  async getSignalStats(symbol?: string) {
    const res = await axios.get(`${BASE_URL}/api/signals/stats`, {
      params: symbol ? { symbol } : {},
    });
    return res.data;
  },

  async getCalibration() {
    const res = await axios.get(`${BASE_URL}/api/signals/calibration`);
    return res.data;
  },

  async getStrategyStats() {
    const res = await axios.get(`${BASE_URL}/api/signals/strategy-stats`);
    return res.data;
  },

  // ── Market focus / watchlist ───────────────────────────────────────────────
  async getMarketFocus() {
    const res = await axios.get(`${BASE_URL}/api/market/focus`);
    return res.data;
  },

  async getWatchlist() {
    const res = await axios.get(`${BASE_URL}/api/market/watchlist`);
    return res.data;
  },

  async getCurrencyStrength() {
    const res = await axios.get(`${BASE_URL}/api/market/strength`);
    return res.data;
  },

  // ── Health ─────────────────────────────────────────────────────────────────
  async getHealth() {
    const res = await axios.get(`${BASE_URL}/api/health`);
    return res.data;
  },

  // ── Analysis ───────────────────────────────────────────────────────────────
  async getAnalysis(symbol?: string) {
    const res = await axios.get(`${BASE_URL}/api/analysis`, { params: symbol ? { symbol } : {} });
    return res.data;
  },

  async refreshAnalysis(symbol?: string) {
    const res = await axios.post(`${BASE_URL}/api/analysis/refresh`, null, {
      params: symbol ? { symbol } : {},
    });
    return res.data;
  },

  // ── News ───────────────────────────────────────────────────────────────────
  async getNews(params?: { currency?: string; impact?: string }) {
    const res = await axios.get(`${BASE_URL}/api/news`, { params });
    return res.data;
  },

  // ── Journal (unchanged) ────────────────────────────────────────────────────
  async getTrades() {
    const headers = await getAuthHeader();
    const res = await axios.get(`${BASE_URL}/api/journal`, { headers });
    return res.data;
  },
  async getTradeStats() {
    const headers = await getAuthHeader();
    const res = await axios.get(`${BASE_URL}/api/journal/stats`, { headers });
    return res.data;
  },
  async createTrade(trade: Record<string, unknown>) {
    const headers = await getAuthHeader();
    const res = await axios.post(`${BASE_URL}/api/journal`, trade, { headers });
    return res.data;
  },
  async updateTrade(id: string, updates: Record<string, unknown>) {
    const headers = await getAuthHeader();
    const res = await axios.put(`${BASE_URL}/api/journal/${id}`, updates, { headers });
    return res.data;
  },
  async deleteTrade(id: string) {
    const headers = await getAuthHeader();
    const res = await axios.delete(`${BASE_URL}/api/journal/${id}`, { headers });
    return res.data;
  },

  async getTradeAlerts() {
    const headers = await getAuthHeader();
    const res = await axios.get(`${BASE_URL}/api/journal/alerts`, { headers });
    return res.data;
  },
};

export default api;
