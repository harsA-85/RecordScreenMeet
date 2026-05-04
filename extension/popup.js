const startBtn = document.getElementById('start');
const stopBtn  = document.getElementById('stop');
const statusEl = document.getElementById('status');
const timerEl  = document.getElementById('timer');
const micEl    = document.getElementById('mic');
const tabEl    = document.getElementById('tabAudio');

let timerInterval = null;

async function refreshState() {
  const { recording, startedAt } = await chrome.storage.local.get(['recording', 'startedAt']);
  if (recording) {
    startBtn.disabled = true;
    stopBtn.disabled  = false;
    statusEl.firstChild.textContent = 'Recording. ';
    if (startedAt) startTimer(startedAt);
  } else {
    startBtn.disabled = false;
    stopBtn.disabled  = true;
    statusEl.firstChild.textContent = 'Idle. ';
    stopTimer();
  }
}

function startTimer(startedAt) {
  stopTimer();
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
  timerEl.textContent = '';
}

startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  statusEl.firstChild.textContent = 'Requesting capture… ';
  const res = await chrome.runtime.sendMessage({
    type: 'START_RECORDING',
    options: { mic: micEl.checked, tabAudio: tabEl.checked }
  });
  if (res?.error) {
    statusEl.firstChild.textContent = 'Error: ' + res.error + ' ';
    startBtn.disabled = false;
    return;
  }
  refreshState();
});

stopBtn.addEventListener('click', async () => {
  stopBtn.disabled = true;
  statusEl.firstChild.textContent = 'Saving… ';
  await chrome.runtime.sendMessage({ type: 'STOP_RECORDING' });
  refreshState();
});

refreshState();
