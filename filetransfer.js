// filetransfer.js — chunked send/receive over a dedicated DataChannel.
// Protocol (one transfer at a time per channel, enforced by the caller):
//   1. sender -> JSON text: {type:'file-start', name, size, mime}
//   2. sender -> N binary ArrayBuffer chunks (16KB each)
//   3. sender -> JSON text: {type:'file-end'}
// Receiver assembles chunks in order (DataChannel is ordered by default).
//
// Prototype limitation: whole file is held in memory on both ends. Fine for
// documents/images/spreadsheets; add a size cap in the UI for large media.

const CHUNK_SIZE = 16 * 1024;
const BUFFERED_AMOUNT_LOW_THRESHOLD = 256 * 1024; // backpressure watermark
const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200MB prototype cap — raise deliberately if needed

function waitForDrain(channel) {
  return new Promise((resolve) => {
    if (channel.bufferedAmount <= BUFFERED_AMOUNT_LOW_THRESHOLD) return resolve();
    channel.bufferedAmountLowThreshold = BUFFERED_AMOUNT_LOW_THRESHOLD;
    channel.addEventListener('bufferedamountlow', function onLow() {
      channel.removeEventListener('bufferedamountlow', onLow);
      resolve();
    });
  });
}

async function sendFile(channel, arrayBuffer, meta, onProgress) {
  if (arrayBuffer.byteLength > MAX_FILE_SIZE) {
    throw new Error(`הקובץ גדול מדי (מעל ${MAX_FILE_SIZE / 1024 / 1024}MB) עבור אב-הטיפוס הזה`);
  }
  channel.send(JSON.stringify({ type: 'file-start', name: meta.name, size: arrayBuffer.byteLength, mime: meta.mime || 'application/octet-stream' }));

  let offset = 0;
  while (offset < arrayBuffer.byteLength) {
    await waitForDrain(channel);
    const chunk = arrayBuffer.slice(offset, offset + CHUNK_SIZE);
    channel.send(chunk);
    offset += chunk.byteLength;
    if (onProgress) onProgress(offset / arrayBuffer.byteLength);
  }
  channel.send(JSON.stringify({ type: 'file-end' }));
}

// Returns an object with handleMessage(event-data) to feed into channel.onmessage.
// Calls onComplete({ name, mime, size, arrayBuffer }) once a transfer finishes,
// and onProgress(fraction) during receipt.
function makeReceiver({ onStart, onProgress, onComplete }) {
  let meta = null;
  let chunks = [];
  let received = 0;

  return {
    handleMessage(data) {
      if (typeof data === 'string') {
        const msg = JSON.parse(data);
        if (msg.type === 'file-start') {
          meta = msg; chunks = []; received = 0;
          if (onStart) onStart(meta);
        } else if (msg.type === 'file-end' && meta) {
          const blob = new Blob(chunks);
          blob.arrayBuffer().then(buf => {
            onComplete({ name: meta.name, mime: meta.mime, size: meta.size, arrayBuffer: buf });
            meta = null; chunks = [];
          });
        }
        return true; // consumed as a control message
      }
      // Binary chunk (ArrayBuffer or Blob depending on channel.binaryType)
      if (meta) {
        chunks.push(data);
        received += data.byteLength ?? data.size ?? 0;
        if (onProgress) onProgress(received / meta.size);
      }
      return false;
    }
  };
}

window.FileTransfer = { sendFile, makeReceiver, MAX_FILE_SIZE };
