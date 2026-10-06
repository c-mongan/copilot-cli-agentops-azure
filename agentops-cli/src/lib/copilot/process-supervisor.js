const childProcess = require('node:child_process');

// Keep the event loop available for Collector exit and cancellation events.
function superviseProcess(command, args, options, collector, dependencies = {}) {
  const spawn = dependencies.spawn || childProcess.spawn;
  const signals = dependencies.signals || process;
  const graceMs = dependencies.graceMs ?? 4000;
  return new Promise((resolve) => {
    let child;
    let timer;
    let settled = false;
    let collectorFailed = false;
    let aborted = false;
    let cancelled = false;
    const abort = () => { aborted = true; cancel('SIGTERM'); };
    const handlers = new Map();
    const kill = signal => {
      if (!child?.pid || settled) return;
      try {
        if (process.platform !== 'win32') process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch { try { child.kill(signal); } catch {} }
    };
    const cancel = signal => {
      cancelled = true;
      kill(signal);
      if (!timer) timer = setTimeout(() => kill('SIGKILL'), graceMs);
    };
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const [signal, handler] of handlers) signals.removeListener(signal, handler);
      dependencies.abortSignal?.removeEventListener('abort', abort);
      resolve({ ...result, collectorFailed, aborted, cancelled });
    };
    if (dependencies.abortSignal?.aborted) {
      aborted = true;
      cancelled = true;
      finish({ status: null, signal: 'SIGTERM' });
      return;
    }
    try {
      child = spawn(command, args, { ...options, detached: process.platform !== 'win32' });
    } catch (error) { finish({ status: null, error }); return; }
    child.once('error', error => finish({ status: null, error }));
    child.once('close', (status, signal) => {
      // A signalled launcher can exit before its own descendants. Reap the
      // owned process group so cancellation cannot leave model work running.
      if (signal || cancelled) kill('SIGKILL');
      finish({ status, signal });
    });
    for (const signal of ['SIGINT', 'SIGTERM']) {
      const handler = () => cancel(signal);
      handlers.set(signal, handler);
      signals.on(signal, handler);
    }
    dependencies.abortSignal?.addEventListener('abort', abort, { once: true });
    if (dependencies.abortSignal?.aborted) abort();
    if (collector.exited) collector.exited.then(() => {
      if (settled) return;
      collectorFailed = true;
      cancel('SIGTERM');
    });
  });
}

module.exports = { superviseProcess };
