const store = new Map();

const cache = {
  set(key, value, ttlSeconds) {
    const expiresAt = Date.now() + ttlSeconds * 1000;
    store.set(key, { value, expiresAt });
  },

  get(key) {
    const entry = store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      store.delete(key);
      return null;
    }
    return entry.value;
  },

  del(key) {
    store.delete(key);
  },

  clear() {
    store.clear();
  }
};

module.exports = cache;
