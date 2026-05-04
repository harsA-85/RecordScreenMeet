// Toolbar click -> open the recorder page in a small popup window.
// Reuses the existing window if it's already open.

const RECORDER_URL = 'recorder.html';

async function openRecorder() {
  const url = chrome.runtime.getURL(RECORDER_URL);
  // Reuse existing recorder window if any.
  const tabs = await chrome.tabs.query({ url });
  if (tabs.length > 0) {
    await chrome.windows.update(tabs[0].windowId, { focused: true });
    await chrome.tabs.update(tabs[0].id, { active: true });
    return;
  }
  await chrome.windows.create({
    url,
    type: 'popup',
    width: 720,
    height: 640
  });
}

chrome.action.onClicked.addListener(openRecorder);
