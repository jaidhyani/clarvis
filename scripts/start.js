#!/usr/bin/env node

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.CLARVIS_DATA_DIR || path.join(os.homedir(), '.clarvis');
const pidFile = path.join(dataDir, 'clarvis.pid');

function loadEnvFromParents() {
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    const envPath = path.join(dir, '.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex > 0) {
          const key = trimmed.slice(0, eqIndex);
          const value = trimmed.slice(eqIndex + 1).replace(/^["']|["']$/g, '');
          if (!process.env[key]) process.env[key] = value;
        }
      }
      break;
    }
    dir = path.dirname(dir);
  }
}

loadEnvFromParents();

fs.mkdirSync(dataDir, { recursive: true });

const serverPath = path.join(__dirname, '..', 'server', 'index.js');
const watchMode = process.argv.includes('--watch');
const userArgs = process.argv.slice(2).filter(arg => arg !== '--watch');

const nodeArgs = watchMode ? ['--watch', serverPath, ...userArgs] : [serverPath, ...userArgs];
const child = spawn(process.execPath, nodeArgs, {
  stdio: 'inherit',
  cwd: path.join(__dirname, '..'),
});

fs.writeFileSync(pidFile, String(child.pid));

child.on('exit', (code) => {
  fs.rmSync(pidFile, { force: true });
  process.exit(code ?? 0);
});

process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
