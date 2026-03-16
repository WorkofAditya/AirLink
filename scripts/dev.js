const { spawn } = require('child_process');

function run(name, cmd, args, opts = {}) {
  const child = spawn(cmd, args, { stdio: 'inherit', ...opts });
  child.on('exit', (code) => {
    if (code !== 0) {
      console.error(`[${name}] exited with code ${code}`);
      process.exit(code || 1);
    }
  });
  return child;
}

const worker = run('worker', 'npx', ['wrangler', 'dev', '--port', '8787'], { cwd: 'worker' });
const frontend = run('frontend', 'python3', ['-m', 'http.server', '8080']);

function shutdown() {
  worker.kill('SIGINT');
  frontend.kill('SIGINT');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
