# Meeting Recorder

Record any meeting (Google Meet, MS Teams, Zoom web, anything on your screen),
transcribe it, and get an AI-generated summary + action items emailed to you and
saved as JSON.

Two pieces:

| Piece | What it does |
|-------|--------------|
| `extension/` | Chrome / Firefox extension. Captures screen + tab/system audio + microphone, mixes them, and saves a `.webm` file to your `Downloads/meeting-recorder/` folder. |
| `processor/` | Node CLI. Takes the `.webm`, runs OpenAI Whisper for transcription, runs Claude Sonnet 4.6 for summary + next steps, writes JSON, and emails the recap via Gmail. |

The extension never touches API keys. All AI calls run locally from your machine.

---

## 1. Install the extension

### Chrome / Edge / Brave / Arc
1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right)
3. Click **Load unpacked** and pick the `extension/` folder
4. Pin the **Meeting Recorder** icon to your toolbar

### Firefox 128+ (temporary install, no signing required)
1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on…** and pick `extension/manifest.json`
3. The add-on stays loaded until Firefox is closed — re-load it next session.

### Recording
1. Click the toolbar icon — a small **Meeting Recorder** window opens.
2. Toggle mic / system-audio as desired, then click **Pick what to share & start**.
3. The browser shows its share picker. Pick **Entire Screen**, a **Window**, or a **Tab**.
   To also capture meeting audio, tick **Share tab audio** (Chrome) or
   **Share audio** (Firefox, available when sharing a tab or — on Windows/Linux —
   a screen).
4. Click **Stop & save** when done. The file lands in `~/Downloads/meeting-recorder/`.
5. Keep the recorder window open during recording — closing it stops the capture.

---

## 2. Set up the processor

```bash
cd processor
npm install
cp .env.example .env
# fill in OPENAI_API_KEY, ANTHROPIC_API_KEY, GMAIL_USER, GMAIL_APP_PASSWORD, EMAIL_TO
```

Gmail App Password: <https://myaccount.google.com/apppasswords> (requires 2FA on
the Google account). Don't use your real password.

### Run it on a recording
```bash
node process-recording.js ~/Downloads/meeting-recorder/meeting-2026-05-04T15-22-10.webm
```

Skip the email:
```bash
node process-recording.js path/to/file.webm --no-email
```

Output lands in `processor/out/`:
- `<name>.transcript.json` — Whisper transcript with per-segment timestamps
- `<name>.analysis.json` — full result: summary, key points, decisions, next steps, open questions, participants, plus the full transcript

---

## Notes & limits

- **Whisper has a 25 MB per-file limit.** A 1080p screen recording with audio
  hits this fast. If you only need the audio for transcription, the simplest
  workaround is to extract it with ffmpeg first:
  ```bash
  ffmpeg -i input.webm -vn -ac 1 -ar 16000 -b:a 32k output.m4a
  node process-recording.js output.m4a
  ```
- **System audio capture on macOS** requires picking "Share tab audio" when the
  share picker comes up; full-desktop audio isn't exposed by Chrome or Firefox
  on macOS. On Windows and Linux, "Share system audio" works for full-screen
  sharing in both browsers.
- **Firefox audio quirks**: Firefox only offers the audio checkbox for tabs and
  (Windows/Linux) screens, not for individual windows. If you need to capture a
  Teams desktop app meeting on Firefox/macOS, use Chrome instead.
- **Privacy**: recordings stay on your machine. Whisper + Claude API calls send
  the audio + transcript to OpenAI / Anthropic respectively.
- **Cost** (rough): Whisper $0.006/min + Claude analysis ~$0.01-0.05 per meeting.

## Next things you might want to add

- Auto-watch `~/Downloads/meeting-recorder/` and process new files automatically
- Append next steps to a Google Sheet (Sheets API)
- Diarization (who said what) — swap Whisper for AssemblyAI/Deepgram
- Push action items to Linear / Jira / Notion
