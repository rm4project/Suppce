const offerCode = document.getElementById('offerCode');
const answerCode = document.getElementById('answerCode');
const connectBtn = document.getElementById('connectBtn');
const video = document.getElementById('remoteVideo');
const statusEl = document.getElementById('status');
const labelInput = document.getElementById('supporterLabel');
const abList = document.getElementById('abList');
const abSearch = document.getElementById('abSearch');
const currentMachineCard = document.getElementById('currentMachineCard');
const curName = document.getElementById('curName');
const curNickname = document.getElementById('curNickname');
const curGroup = document.getElementById('curGroup');
const curNotes = document.getElementById('curNotes');
const saveAbBtn = document.getElementById('saveAbBtn');
const sendFileBtn = document.getElementById('sendFileBtn');
const filePicker = document.getElementById('filePicker');
const fileProgress = document.getElementById('fileProgress');

let pc, controlChannel, filesDownChannel, filesUpChannel;
let approved = false;
let myIdentity, currentMachineFingerprint, fileReceiver;

function setStatus(t) { statusEl.textContent = `סטטוס: ${t}`; }

// --- Address book rendering --------------------------------------------------
function renderAddressBook() {
  const grouped = window.AddressBook.search(abSearch.value);
  abList.innerHTML = Object.keys(grouped).sort().map(group => `
    <div class="ab-group">${group}</div>
    ${grouped[group].map(e => `
      <div class="ab-entry ${e.fingerprint === currentMachineFingerprint ? 'ab-current' : ''}">
        <div class="name">${e.nickname || '(ללא כינוי)'}</div>
        <div>${e.notes || ''}</div>
        <div style="color:#666">${e.fingerprint.slice(0, 10)}…</div>
      </div>`).join('')}
  `).join('') || '<div style="color:#666;font-size:12px">אין עדיין רשומות</div>';
}
abSearch.addEventListener('input', renderAddressBook);

// --- WebRTC setup -------------------------------------------------------------
async function connect() {
  myIdentity = await window.Identity.getOrCreateIdentity();
  try {
    const offer = JSON.parse(atob(offerCode.value.trim()));
    pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });

    pc.ontrack = (e) => { video.srcObject = e.streams[0]; };
    pc.ondatachannel = (e) => {
      if (e.channel.label === 'control') { controlChannel = e.channel; wireControlChannel(controlChannel); }
      if (e.channel.label === 'files-down') { filesDownChannel = e.channel; wireIncomingFileChannel(filesDownChannel); }
      if (e.channel.label === 'files-up') { filesUpChannel = e.channel; } // we send on this one
    };

    await pc.setRemoteDescription(offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitForIce(pc);

    answerCode.value = btoa(JSON.stringify(pc.localDescription));
    setStatus('שלח את קוד התשובה למורה');
  } catch (err) {
    setStatus('קוד לא תקין: ' + err.message);
  }
}

function waitForIce(peerConnection) {
  return new Promise((resolve) => {
    if (peerConnection.iceGatheringState === 'complete') return resolve();
    peerConnection.addEventListener('icegatheringstatechange', function check() {
      if (peerConnection.iceGatheringState === 'complete') {
        peerConnection.removeEventListener('icegatheringstatechange', check);
        resolve();
      }
    });
  });
}

function wireControlChannel(channel) {
  channel.onopen = () => {
    setStatus('מחובר — מאמת זהות מול המורה...');
    channel.send(JSON.stringify({
      type: 'hello',
      supporterLabel: labelInput.value || 'תומך',
      publicKeyJwk: myIdentity.publicKeyJwk
    }));
  };

  channel.onmessage = async (msg) => {
    const data = JSON.parse(msg.data);

    if (data.type === 'machine-info') {
      // Informational only — lets the address book auto-match this session
      // to a saved nickname/group by the teacher machine's persistent fingerprint.
      currentMachineFingerprint = data.fingerprint;
      const saved = window.AddressBook.get(data.fingerprint);
      currentMachineCard.style.display = 'block';
      curName.textContent = data.nickname
        ? `המחשב מדווח כינוי: ${data.nickname}`
        : `זהות: ${data.fingerprint.slice(0, 12)}…`;
      curNickname.value = saved?.nickname || data.nickname || '';
      curGroup.value = saved?.group || '';
      curNotes.value = saved?.notes || '';
      renderAddressBook();
      return;
    }

    if (data.type === 'challenge') {
      const signature = await window.Identity.signChallenge(myIdentity.privateKeyJwk, data.challenge);
      channel.send(JSON.stringify({ type: 'challenge-response', signature }));
      return;
    }

    if (data.type === 'consent-result') {
      approved = data.approved;
      sendFileBtn.disabled = !approved;
      setStatus(approved ? 'מאושר — שליטה פעילה' : 'המורה דחה את הבקשה');
    }
  };

  channel.onclose = () => { approved = false; sendFileBtn.disabled = true; setStatus('החיבור נסגר'); };
}

saveAbBtn.addEventListener('click', () => {
  if (!currentMachineFingerprint) return;
  window.AddressBook.upsert(currentMachineFingerprint, {
    nickname: curNickname.value, group: curGroup.value || 'ללא קבוצה', notes: curNotes.value
  });
  renderAddressBook();
});

// --- Mouse/keyboard capture (unchanged, gated on `approved`) ----------------
function send(evt) {
  if (approved && controlChannel && controlChannel.readyState === 'open') {
    controlChannel.send(JSON.stringify(evt));
  }
}
video.addEventListener('mousemove', (e) => {
  const r = video.getBoundingClientRect();
  send({ type: 'move', x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
});
video.addEventListener('mousedown', (e) => {
  const r = video.getBoundingClientRect();
  send({ type: 'click', x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, button: e.button === 2 ? 'right' : 'left' });
});
video.addEventListener('wheel', (e) => send({ type: 'scroll', deltaY: e.deltaY }));
window.addEventListener('keydown', (e) => {
  if (document.activeElement.tagName === 'INPUT') return;
  send({ type: 'keydown', key: e.key });
  e.preventDefault();
});

// --- File transfer: receiving from teacher -----------------------------------
function wireIncomingFileChannel(channel) {
  fileReceiver = window.FileTransfer.makeReceiver({
    onStart: (meta) => { fileProgress.textContent = `מתקבל: ${meta.name} (0%)`; },
    onProgress: (frac) => { fileProgress.textContent = `מתקבל... ${Math.round(frac * 100)}%`; },
    onComplete: ({ name, mime, arrayBuffer }) => {
      const blob = new Blob([arrayBuffer], { type: mime });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      fileProgress.textContent = `התקבל והורד: ${name}`;
    }
  });
  channel.onmessage = (e) => { if (approved) fileReceiver.handleMessage(e.data); };
}

// --- File transfer: sending to teacher ----------------------------------------
sendFileBtn.addEventListener('click', () => filePicker.click());
filePicker.addEventListener('change', async () => {
  const file = filePicker.files[0];
  if (!file || !approved || !filesUpChannel) return;
  const buf = await file.arrayBuffer();
  fileProgress.textContent = `שולח ${file.name}... 0%`;
  await window.FileTransfer.sendFile(filesUpChannel, buf, { name: file.name, mime: file.type }, (frac) => {
    fileProgress.textContent = `שולח ${file.name}... ${Math.round(frac * 100)}%`;
  });
  fileProgress.textContent = `נשלח: ${file.name}`;
});

connectBtn.addEventListener('click', connect);
renderAddressBook();
