// Offscreen document: holds the MediaRecorder + media streams.

let recorder = null;
let chunks = [];
let activeStreams = [];

function pickMimeType() {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm'
  ];
  return candidates.find(t => MediaRecorder.isTypeSupported(t)) || 'video/webm';
}

async function startRecording({ streamId, mic }) {
  if (recorder) throw new Error('Already recording.');
  chunks = [];
  activeStreams = [];

  // Desktop stream (video + optional system/tab audio depending on user pick).
  const desktopStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: streamId
      }
    },
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: streamId
      }
    }
  }).catch(async (err) => {
    // Some picks won't include audio (e.g. window with no audio). Retry video-only.
    if (String(err).includes('audio')) {
      return navigator.mediaDevices.getUserMedia({
        video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: streamId } }
      });
    }
    throw err;
  });
  activeStreams.push(desktopStream);

  let micStream = null;
  if (mic) {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      activeStreams.push(micStream);
    } catch (err) {
      console.warn('Mic capture failed; continuing without mic.', err);
    }
  }

  // Mix all audio sources into a single track so MediaRecorder captures everyone.
  const audioCtx = new AudioContext();
  const dest = audioCtx.createMediaStreamDestination();
  let hasAudio = false;
  for (const s of [desktopStream, micStream]) {
    if (!s) continue;
    const tracks = s.getAudioTracks();
    if (tracks.length === 0) continue;
    audioCtx.createMediaStreamSource(new MediaStream(tracks)).connect(dest);
    hasAudio = true;
  }

  const finalStream = new MediaStream();
  desktopStream.getVideoTracks().forEach(t => finalStream.addTrack(t));
  if (hasAudio) dest.stream.getAudioTracks().forEach(t => finalStream.addTrack(t));

  // Auto-stop if user ends the share via the browser's native control.
  desktopStream.getVideoTracks()[0]?.addEventListener('ended', () => stopRecording());

  recorder = new MediaRecorder(finalStream, { mimeType: pickMimeType() });
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  recorder.onstop = async () => {
    const blob = new Blob(chunks, { type: recorder.mimeType });
    const url = URL.createObjectURL(blob);
    await chrome.runtime.sendMessage({ type: 'SAVE_BLOB_URL', url });
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    activeStreams.forEach(s => s.getTracks().forEach(t => t.stop()));
    activeStreams = [];
    recorder = null;
  };
  recorder.start(1000); // 1s timeslices
}

function stopRecording() {
  if (recorder && recorder.state !== 'inactive') recorder.stop();
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target !== 'offscreen') return;
  (async () => {
    try {
      if (msg.type === 'OFFSCREEN_START') { await startRecording(msg); sendResponse({ ok: true }); }
      else if (msg.type === 'OFFSCREEN_STOP') { stopRecording(); sendResponse({ ok: true }); }
    } catch (err) {
      console.error('[offscreen]', err);
      sendResponse({ error: err.message || String(err) });
    }
  })();
  return true;
});
