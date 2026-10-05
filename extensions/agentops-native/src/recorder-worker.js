const fs = require('node:fs');
const { startScopedStrictCollector } = fs.existsSync(require('node:path').join(__dirname, '../runtime/package.json'))
  ? require('../runtime/src/lib/copilot/scoped-collector') : require('../../../agentops-cli/src/lib/copilot/scoped-collector');
const path = require('node:path');
const abort = new AbortController();
let collector, stopping, starting;
async function stop() {
  if (stopping) return stopping;
  stopping = (async () => {
    abort.abort();
    try { await starting; } catch {}
    if (collector) await collector.stop({ remove: false });
    process.exit(0);
  })();
  return stopping;
}
process.on('disconnect', () => stop().catch(() => process.exit(1)));
process.on('SIGTERM', () => stop().catch(() => process.exit(1)));
process.on('SIGINT', () => stop().catch(() => process.exit(1)));
process.on('uncaughtException', () => stop().catch(() => process.exit(1)));
process.on('unhandledRejection', () => stop().catch(() => process.exit(1)));
process.on('message', message => {
  if (message?.type === 'stop') { stop().catch(() => process.exit(1)); return; }
  if (message?.type !== 'start' || starting || stopping) return;
  starting = startScopedStrictCollector({ receiverPort: message.receiverPort, tempRoot: path.join(message.storage, 'receipts'), agentopsHome: message.storage, abortSignal: abort.signal, findCollectorBinary: () => ({ ok: true, path: message.binary }) }).then(active => {
    collector = active;
    if (process.connected && !stopping) process.send({ type: 'ready', endpoint: collector.endpoint, receiptPath: collector.receiptPath, pid: collector.pid });
    collector.exited.then(result => {
      if (process.connected) process.send({ type: 'stopped', ...result });
      return stop();
    });
  });
  starting.catch(error => { if (process.connected) process.send({ type: 'failed', reason: error.reason }); stop().catch(() => process.exit(1)); });
});
