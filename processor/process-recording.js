#!/usr/bin/env node
// Process a meeting recording: transcribe (Whisper) -> analyze (Claude) -> save JSON + email.
//
// Usage:  node process-recording.js <path-to-recording.webm> [--no-email]

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import dns from 'node:dns';
import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import nodemailer from 'nodemailer';

// Prefer IPv4 + OS resolver: avoids c-ares EDNS timeouts seen on some Windows networks.
dns.setDefaultResultOrder('ipv4first');

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const noEmailFlag = args.includes('--no-email');
const forceFlag = args.includes('--force');
const inputPath = args.find(a => !a.startsWith('--'));

if (!inputPath) {
  console.error('Usage: process-recording <path-to-recording.webm> [--no-email] [--force]');
  process.exit(1);
}
if (!fs.existsSync(inputPath)) {
  console.error(`File not found: ${inputPath}`);
  process.exit(1);
}

const {
  OPENAI_API_KEY,
  ANTHROPIC_API_KEY,
  GMAIL_USER,
  GMAIL_APP_PASSWORD,
  EMAIL_TO,
  CLAUDE_MODEL = 'claude-sonnet-4-6',
  WHISPER_MODEL = 'whisper-1',
  OUTPUT_DIR = path.join(__dirname, 'out'),
  SEND_EMAIL = 'true'
} = process.env;

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const baseName = path.basename(inputPath, path.extname(inputPath));
const transcriptPath = path.join(OUTPUT_DIR, `${baseName}.transcript.json`);
const jsonPath = path.join(OUTPUT_DIR, `${baseName}.analysis.json`);

const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;
const anthropic = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null;

async function transcribe(file) {
  const sizeMB = fs.statSync(file).size / (1024 * 1024);
  console.log(`Transcribing (${sizeMB.toFixed(1)} MB) with ${WHISPER_MODEL}…`);
  if (sizeMB > 25) {
    console.warn('  ! File >25MB — Whisper will reject. Split with ffmpeg first.');
  }
  const res = await openai.audio.transcriptions.create({
    file: fs.createReadStream(file),
    model: WHISPER_MODEL,
    response_format: 'verbose_json',
    timestamp_granularities: ['segment']
  });
  return {
    text: res.text,
    language: res.language,
    duration: res.duration,
    segments: (res.segments || []).map(s => ({
      start: s.start, end: s.end, text: s.text.trim()
    }))
  };
}

const ANALYSIS_PROMPT = `You are an expert meeting analyst. Given a raw meeting transcript, produce a JSON object with these fields:

{
  "summary": "3-6 sentence executive summary of what was discussed and decided",
  "key_points": ["bulleted highlights"],
  "decisions": ["explicit decisions made"],
  "next_steps": [
    { "action": "what to do", "owner": "person or 'unassigned'", "due": "YYYY-MM-DD or 'unspecified'", "context": "1 sentence why" }
  ],
  "open_questions": ["unresolved items"],
  "participants": ["names mentioned, if any"]
}

Be concrete. Pull owners and due dates from the transcript when stated. Do not invent details. Respond with ONLY the JSON, no prose.`;

async function analyze(transcript) {
  console.log(`Analyzing with ${CLAUDE_MODEL}…`);
  const msg = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    system: ANALYSIS_PROMPT,
    messages: [{ role: 'user', content: `Transcript:\n\n${transcript}` }]
  });
  const text = msg.content.map(b => b.text || '').join('').trim();
  // Strip ``` fences if Claude added them.
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    console.warn('Claude returned non-JSON; preserving raw text.');
    return { raw: text };
  }
}

function renderEmail(analysis, meta) {
  const ns = (analysis.next_steps || []).map(s =>
    `  • [${s.owner || 'unassigned'}] ${s.action}${s.due && s.due !== 'unspecified' ? ` (due ${s.due})` : ''}`
  ).join('\n') || '  (none extracted)';
  const decisions = (analysis.decisions || []).map(d => `  • ${d}`).join('\n') || '  (none)';
  const open = (analysis.open_questions || []).map(q => `  • ${q}`).join('\n') || '  (none)';

  const text = `Meeting recap — ${meta.recording}

Duration: ${meta.duration ? meta.duration.toFixed(0) + 's' : 'unknown'}
Language: ${meta.language || 'unknown'}

SUMMARY
${analysis.summary || '(no summary)'}

NEXT STEPS
${ns}

DECISIONS
${decisions}

OPEN QUESTIONS
${open}

Full JSON + transcript saved at:
  ${meta.jsonPath}
  ${meta.transcriptPath}
`;
  return { subject: `Meeting recap — ${meta.recording}`, text };
}

async function sendEmail(body) {
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD || !EMAIL_TO) {
    console.warn('Email skipped: GMAIL_USER / GMAIL_APP_PASSWORD / EMAIL_TO not set.');
    return;
  }
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD }
  });
  await transporter.sendMail({
    from: GMAIL_USER,
    to: EMAIL_TO,
    subject: body.subject,
    text: body.text
  });
  console.log(`Email sent to ${EMAIL_TO}`);
}

(async () => {
  let transcript;
  if (!forceFlag && fs.existsSync(transcriptPath)) {
    console.log(`Transcript cache hit -> ${transcriptPath} (skipping Whisper; use --force to redo)`);
    transcript = JSON.parse(fs.readFileSync(transcriptPath, 'utf8'));
  } else {
    if (!openai) { console.error('Missing OPENAI_API_KEY'); process.exit(1); }
    transcript = await transcribe(inputPath);
    fs.writeFileSync(transcriptPath, JSON.stringify(transcript, null, 2));
    console.log(`Transcript -> ${transcriptPath}`);
  }

  let result;
  if (!forceFlag && fs.existsSync(jsonPath)) {
    console.log(`Analysis cache hit -> ${jsonPath} (skipping Claude; use --force to redo)`);
    result = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } else {
    if (!anthropic) { console.error('Missing ANTHROPIC_API_KEY'); process.exit(1); }
    const analysis = await analyze(transcript.text);
    result = {
      recording: path.basename(inputPath),
      processed_at: new Date().toISOString(),
      duration_sec: transcript.duration,
      language: transcript.language,
      analysis,
      transcript: transcript.text
    };
    fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2));
    console.log(`Analysis  -> ${jsonPath}`);
  }
  const analysis = result.analysis;

  const shouldEmail = !noEmailFlag && SEND_EMAIL.toLowerCase() !== 'false';
  if (shouldEmail) {
    const body = renderEmail(analysis, {
      recording: path.basename(inputPath),
      duration: transcript.duration,
      language: transcript.language,
      jsonPath,
      transcriptPath
    });
    try {
      await sendEmail(body);
    } catch (err) {
      console.warn(`Email failed (${err.code || err.name}): ${err.message}. Analysis JSON is saved at ${jsonPath}.`);
    }
  }

  console.log('Done.');
})().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
