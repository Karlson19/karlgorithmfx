// Minimal in-memory stand-in for the Supabase client, covering only the calls
// the signal/calibration code makes. Tests inject it before loading services.
const path = require('path');

function makeFakeSupabase() {
  const tables = { signals: [], shadow_signals: [] };
  let idCounter = 0;

  const from = (name) => {
    const st = { filters: [], op: 'select', payload: null, limit: null, single: false };
    const b = {
      select() { return b; },
      order() { return b; },
      limit(n) { st.limit = n; return b; },
      single() { st.single = true; return b; },
      eq(c, v) { st.filters.push(r => r[c] === v); return b; },
      neq(c, v) { st.filters.push(r => r[c] !== v); return b; },
      gte(c, v) { st.filters.push(r => r[c] >= v); return b; },
      lt(c, v) { st.filters.push(r => r[c] < v); return b; },
      is(c, v) { st.filters.push(r => (v === null ? r[c] == null : r[c] === v)); return b; },
      not(c, op, v) { st.filters.push(r => (op === 'is' && v === null ? r[c] != null : r[c] !== v)); return b; },
      insert(p) { st.op = 'insert'; st.payload = p; return b; },
      update(p) { st.op = 'update'; st.payload = p; return b; },
      then(resolve, reject) {
        try {
          const rows = tables[name];
          if (!rows) return resolve({ data: null, error: { message: `relation "${name}" does not exist` } });
          if (st.op === 'insert') {
            const row = { id: `id-${++idCounter}`, created_at: new Date().toISOString(), outcome: null, ...st.payload };
            rows.push(row);
            return resolve({ data: st.single ? row : [row], error: null });
          }
          const matched = rows.filter(r => st.filters.every(f => f(r)));
          if (st.op === 'update') {
            matched.forEach(r => Object.assign(r, st.payload));
            return resolve({ data: matched, error: null });
          }
          const out = st.limit ? matched.slice(0, st.limit) : matched;
          return resolve({ data: out, error: null });
        } catch (e) { return reject ? reject(e) : resolve({ data: null, error: { message: e.message } }); }
      },
    };
    return b;
  };
  return { from, tables };
}

// Put `exports` in place of a module BEFORE it is first required.
function stubModule(relPath, exports) {
  const resolved = require.resolve(relPath, { paths: [__dirname] });
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
  return resolved;
}

// Drop our services from the require cache so each test file starts clean.
function freshRequire(relPath) {
  const resolved = require.resolve(relPath, { paths: [__dirname] });
  delete require.cache[resolved];
  return require(resolved);
}

module.exports = { makeFakeSupabase, stubModule, freshRequire, path };
