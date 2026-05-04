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

### Firefox (temporary install, no signing required)
1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on…** and pick `extension/manifest.json`
   (Firefox MV3 support varies — Chrome is the primary target.)

### Recording
1. Click the toolbar icon → choose mic / tab-audio toggles → **Start recording**
2. The browser will ask what to share — pick **Entire Screen**, **Window**, or **Chrome Tab**
   (to also capture meeting audio, tick "Share tab audio" / "Share system audio")
3. Click **Stop & save** when done. The file lands in `~/Downloads/meeting-recorder/`.

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
  share picker comes up; full-desktop audio isn't exposed by Chrome on macOS.
  On Windows and Linux, "Share system audio" works for full-screen sharing.
- **Privacy**: recordings stay on your machine. Whisper + Claude API calls send
  the audio + transcript to OpenAI / Anthropic respectively.
- **Cost** (rough): Whisper $0.006/min + Claude analysis ~$0.01-0.05 per meeting.

## Next things you might want to add

- Auto-watch `~/Downloads/meeting-recorder/` and process new files automatically
- Append next steps to a Google Sheet (Sheets API)
- Diarization (who said what) — swap Whisper for AssemblyAI/Deepgram
- Push action items to Linear / Jira / Notion
