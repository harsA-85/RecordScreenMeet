// Service worker: orchestrates desktop capture + offscreen MediaRecorder.

const OFFSCREEN_PATH = 'offscreen.html';

async function ensureOffscreen() {
  const existing = await chrome.offscreen.hasDocument?.();
  if (existing) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: ['USER_MEDIA', 'DISPLAY_MEDIA'],
    justification: 'Record screen + audio with MediaRecorder for meeting capture.'
  });
}

function pickDesktopMedia(sources, tab) {
  return new Promise((resolve, reject) => {
    const requestId = chrome.desktopCapture.chooseDesktopMedia(sources, tab, (streamId, opts) => {
      if (!streamId) return reject(new Error('User cancelled the capture picker.'));
      resolve({ streamId, opts });
    });
    // Allow popup to close without cancelling: keep requestId reachable.
    self.__captureRequestId = requestId;
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === 'START_RECORDING') {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const sources = ['screen', 'window', 'tab'];
        if (msg.options?.tabAudio) sources.push('audio');
        const { streamId } = await pickDesktopMedia(sources, tab);

        await ensureOffscreen();
        const result = await chrome.runtime.sendMessage({
          target: 'offscreen',
          type: 'OFFSCREEN_START',
          streamId,
          mic: !!msg.options?.mic
        });
        if (result?.error) throw new Error(result.error);

        await chrome.storage.local.set({ recording: true, startedAt: Date.now() });
        sendResponse({ ok: true });
        return;
      }

      if (msg.type === 'STOP_RECORDING') {
        await chrome.runtime.sendMessage({ target: 'offscreen', type: 'OFFSCREEN_STOP' });
        await chrome.storage.local.set({ recording: false, startedAt: null });
        sendResponse({ ok: true });
        return;
      }

      if (msg.type === 'SAVE_BLOB_URL') {
        const filename = msg.filename || `meeting-${new Date().toISOString().replace(/[:.]/g, '-')}.webm`;
        await chrome.downloads.download({
          url: msg.url,
          filename: `meeting-recorder/${filename}`,
          saveAs: false
        });
        sendResponse({ ok: true });
        return;
      }
    } catch (err) {
      console.error('[meeting-recorder]', err);
      sendResponse({ error: err.message || String(err) });
    }
  })();
  return true; // keep channel open for async response
});
