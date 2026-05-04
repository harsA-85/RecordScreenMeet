#!/usr/bin/env node
// Watch a folder for new .webm recordings and, on each one, prompt the user
// before running the transcription + analysis + email pipeline.
//
// Usage:  node watch.js [folder]
// Default folder: %USERPROFILE%\Downloads\meeting-recorder

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultDir = path.join(os.homedir(), 'Downloads', 'meeting-recorder');
const watchDir = process.argv[2] || defaultDir;

if (!fs.existsSync(watchDir)) {
  fs.mkdirSync(watchDir, { recursive: true });
}

const seen = new Set(
  fs.readdirSync(watchDir).filter(f => f.toLowerCase().endsWith('.webm'))
);

console.log(`Watching ${watchDir} for new .webm files… (Ctrl+C to stop)`);
console.log(`Ignoring ${seen.size} pre-existing file(s).`);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(res => rl.question(q, a => res(a.trim().toLowerCase())));

let busy = false;
const queue = [];

async function processOne(filePath) {
  const answer = await ask(`\nNew recording detected: ${path.basename(filePath)}\nRun transcript + summary now? [Y/n] `);
  if (answer === 'n' || answer === 'no') {
    console.log('Skipped.');
    return;
  }
  await new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, 'process-recording.js'), filePath], {
      stdio: 'inherit'
    });
    child.on('exit', (code) => {
      console.log(code === 0 ? 'Pipeline finished.' : `Pipeline exited with code ${code}.`);
      resolve();
    });
  });
}

async function drain() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const next = queue.shift();
    try { await processOne(next); }
    catch (err) { console.error('Error:', err.message); }
  }
  busy = false;
}

// Wait for the file to stop growing before processing — recordings finish writing asynchronously.
function whenStable(filePath, cb) {
  let lastSize = -1;
  const tick = () => {
    fs.stat(filePath, (err, st) => {
      if (err) return;
      if (st.size === lastSize && st.size > 0) return cb();
      lastSize = st.size;
      setTimeout(tick, 1500);
    });
  };
  tick();
}

fs.watch(watchDir, (event, filename) => {
  if (!filename || !filename.toLowerCase().endsWith('.webm')) return;
  if (seen.has(filename)) return;
  const full = path.join(watchDir, filename);
  if (!fs.existsSync(full)) return;
  seen.add(filename);
  whenStable(full, () => {
    queue.push(full);
    drain();
  });
});
