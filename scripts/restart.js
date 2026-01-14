#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.CLARVIS_DATA_DIR || path.join(os.homedir(), '.clarvis');
const pidFile = path.join(dataDir, 'clarvis.pid');
const command = process.argv[2];

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

if (command === 'kill') {
  if (!fs.existsSync(pidFile)) {
    console.log('No server running (no pid file)');
    process.exit(0);
  }

  const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);

  if (!isProcessRunning(pid)) {
    console.log('No server running (stale pid file)');
    fs.rmSync(pidFile, { force: true });
    process.exit(0);
  }

  try {
    process.kill(pid, 'SIGTERM');
    console.log(`Server killed (pid ${pid})`);
    fs.rmSync(pidFile, { force: true });
  } catch (err) {
    console.error(`Failed to kill server: ${err.message}`);
    process.exit(1);
  }
} else {
  const serverIndex = path.join(__dirname, '..', 'server', 'index.js');
  const now = new Date();
  fs.utimesSync(serverIndex, now, now);
  console.log('Restart triggered');
}
