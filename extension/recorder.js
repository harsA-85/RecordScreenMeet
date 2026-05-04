// Recorder page: uses getDisplayMedia + getUserMedia(mic), mixes audio,
// records with MediaRecorder, saves via chrome.downloads.

const startBtn = document.getElementById('start');
const stopBtn  = document.getElementById('stop');
const statusEl = document.getElementById('status');
const timerEl  = document.getElementById('timer');
const micEl    = document.getElementById('mic');
const sysEl    = document.getElementById('sysAudio');

let recorder = null;
let chunks = [];
let activeStreams = [];
let audioCtx = null;
let timerInterval = null;
let startedAt = 0;

function setStatus(msg) { statusEl.firstChild.textContent = msg + ' '; }

function pickMimeType() {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm'
  ];
  return candidates.find(t => MediaRecorder.isTypeSupported(t)) || 'video/webm';
}

function startTimer() {
  startedAt = Date.now();
  const tick = () => {
    const s = Math.floor((Date.now() - startedAt) / 1000);
    const mm = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    timerEl.textContent = `${mm}:${ss}`;
  };
  tick();
  timerInterval = setInterval(tick, 1000);
}
function stopTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
}

async function start() {
  startBtn.disabled = true;
  setStatus('Requesting capture…');
  try {
    const display = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: sysEl.checked
    });
    activeStreams.push(display);

    let mic = null;
    if (micEl.checked) {
      try {
        mic = await navigator.mediaDevices.getUserMedia({ audio: true });
        activeStreams.push(mic);
      } catch (err) {
        console.warn('Mic capture failed; continuing without mic.', err);
      }
    }

    // Mix audio sources into one track so MediaRecorder captures everyone.
    audioCtx = new AudioContext();
    const dest = audioCtx.createMediaStreamDestination();
    let hasAudio = false;
    for (const s of [display, mic]) {
      if (!s) continue;
      const tracks = s.getAudioTracks();
      if (tracks.length === 0) continue;
      audioCtx.createMediaStreamSource(new MediaStream(tracks)).connect(dest);
      hasAudio = true;
    }

    const finalStream = new MediaStream();
    display.getVideoTracks().forEach(t => finalStream.addTrack(t));
    if (hasAudio) dest.stream.getAudioTracks().forEach(t => finalStream.addTrack(t));

    // If user ends share via the browser's native control, stop too.
    display.getVideoTracks()[0]?.addEventListener('ended', () => stop());

    chunks = [];
    recorder = new MediaRecorder(finalStream, { mimeType: pickMimeType() });
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.onstop = onRecorderStop;
    recorder.start(1000);

    stopBtn.disabled = false;
    setStatus('Recording.');
    startTimer();
  } catch (err) {
    console.error(err);
    setStatus('Error: ' + (err.message || err));
    cleanupStreams();
    startBtn.disabled = false;
  }
}

async function onRecorderStop() {
  setStatus('Saving…');
  stopTimer();
  const blob = new Blob(chunks, { type: recorder.mimeType });
  const url = URL.createObjectURL(blob);
  const filename = `meeting-recorder/meeting-${new Date().toISOString().replace(/[:.]/g, '-')}.webm`;
  try {
    await chrome.downloads.download({ url, filename, saveAs: false });
    setStatus('Saved to Downloads/' + filename);
  } catch (err) {
    console.error(err);
    setStatus('Save failed: ' + (err.message || err));
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  cleanupStreams();
  recorder = null;
  startBtn.disabled = false;
  stopBtn.disabled = true;
  timerEl.textContent = '';
}

function stop() {
  stopBtn.disabled = true;
  if (recorder && recorder.state !== 'inactive') recorder.stop();
}

function cleanupStreams() {
  activeStreams.forEach(s => s.getTracks().forEach(t => t.stop()));
  activeStreams = [];
  if (audioCtx) { audioCtx.close().catch(() => {}); audioCtx = null; }
}

startBtn.addEventListener('click', start);
stopBtn.addEventListener('click', stop);

window.addEventListener('beforeunload', (e) => {
  if (recorder && recorder.state !== 'inactive') {
    e.preventDefault();
    e.returnValue = 'Recording in progress — stop before closing.';
    return e.returnValue;
  }
});
