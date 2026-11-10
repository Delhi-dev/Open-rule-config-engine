import { spawn } from 'child_process';
const child = spawn('node', ['rulesets/test/t8-oracle.mjs'], {
  stdio: 'inherit',
});
child.on('close', (code) => {
  process.exit(code ?? 0);
});
