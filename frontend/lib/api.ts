import axios from 'axios';
import { supabase } from './supabase';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

async function getAuthHeader() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}

const api = {
  async getPrice() {
    const res = await axios.get(`${BASE_URL}/api/price/live`);
    return res.data;
  },

  async getHistory(interval = '1h', outputsize = 200) {
    const res = await axios.get(`${BASE_URL}/api/price/history`, {
      params: { interval, outputsize }
    });
    return res.data;
  },

  async getIndicators(interval = '1h') {
    const res = await axios.get(`${BASE_URL}/api/indicators`, { params: { interval } });
    return res.data;
  },

  async getSignal() {
    const res = await axios.get(`${BASE_URL}/api/signals`);
    return res.data;
  },

  async refreshSignal() {
    const res = await axios.post(`${BASE_URL}/api/signals/refresh`);
    return res.data;
  },

  async getAnalysis() {
    const res = await axios.get(`${BASE_URL}/api/analysis`);
    return res.data;
  },

  async refreshAnalysis() {
    const res = await axios.post(`${BASE_URL}/api/analysis/refresh`);
    return res.data;
  },

  async getNews(params?: { currency?: string; impact?: string }) {
    const res = await axios.get(`${BASE_URL}/api/news`, { params });
    return res.data;
  },

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
  }
};

export default api;
