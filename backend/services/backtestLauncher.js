const { fork } = require('child_process');
const os = require('os');
const path = require('path');

// Starts the backtest in a SEPARATE process when RUN_BACKTEST=true.
// A separate process can never write to your database or touch live signals:
// the backtest blocks all database access itself, and it shares no memory with
// this server. Remove RUN_BACKTEST after the report arrives, otherwise it runs
// again on every restart.
function maybeRun() {
  if (process.env.RUN_BACKTEST !== 'true') return null;
  console.log('[backtest] RUN_BACKTEST=true: starting in a separate process. Remove the setting after the report arrives.');
  const child = fork(path.join(__dirname, '..', 'backtest', 'run.js'), [], {
    env: { ...process.env },
    execArgv: ['--max-old-space-size=256'],
  });
  try { os.setPriority(child.pid, 10); } catch { /* lower priority is a nicety */ }
  child.on('exit', (code) => console.log(`[backtest] finished with code ${code}`));
  return child;
}

module.exports = { maybeRun };
