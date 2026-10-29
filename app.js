const state = {
  imageData: null,
  cameraStream: null,
  fileName: '',
  isInspecting: false
};

const elements = {
  fileInput: document.querySelector('#fileInput'),
  cameraButton: document.querySelector('#cameraButton'),
  cameraHint: document.querySelector('#cameraHint'),
  cameraVideo: document.querySelector('#cameraVideo'),
  captureCanvas: document.querySelector('#captureCanvas'),
  imagePreview: document.querySelector('#imagePreview'),
  emptyState: document.querySelector('#emptyState'),
  mediaStage: document.querySelector('#mediaStage'),
  clearButton: document.querySelector('#clearButton'),
  scanLine: document.querySelector('#scanLine'),
  functionId: document.querySelector('#functionId'),
  proxyUrl: document.querySelector('#proxyUrl'),
  inspectButton: document.querySelector('#inspectButton'),
  resultContent: document.querySelector('#resultContent'),
  statusPill: document.querySelector('#statusPill'),
  toast: document.querySelector('#toast')
};

const maxImageBytes = 8 * 1024 * 1024;

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  window.clearTimeout(showToast.timeoutId);
  showToast.timeoutId = window.setTimeout(() => { elements.toast.hidden = true; }, 4500);
}

function setStatus(label, type = 'idle') {
  elements.statusPill.textContent = label;
  elements.statusPill.className = `status-pill ${type}`;
}

function updateInspectButton() {
  elements.inspectButton.disabled = !state.imageData || !elements.functionId.value.trim() || state.isInspecting;
}

function stopCamera() {
  if (state.cameraStream) {
    state.cameraStream.getTracks().forEach(track => track.stop());
    state.cameraStream = null;
  }
  elements.cameraVideo.hidden = true;
  elements.cameraButton.innerHTML = '<span class="button-icon" aria-hidden="true">◎</span> Use camera';
}

function setPreview(dataUrl, fileName) {
  stopCamera();
  state.imageData = dataUrl;
  state.fileName = fileName;
  elements.imagePreview.src = dataUrl;
  elements.imagePreview.hidden = false;
  elements.emptyState.hidden = true;
  elements.clearButton.hidden = false;
  elements.cameraHint.textContent = `${fileName} is ready for inspection.`;
  setStatus('Ready', 'ready');
  updateInspectButton();
}

function clearPreview() {
  stopCamera();
  state.imageData = null;
  state.fileName = '';
  elements.imagePreview.removeAttribute('src');
  elements.imagePreview.hidden = true;
  elements.emptyState.hidden = false;
  elements.clearButton.hidden = true;
  elements.cameraHint.textContent = 'A well-lit, close-up image gives the clearest read.';
  setStatus('Waiting');
  updateInspectButton();
}

function readFile(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    showToast('Please choose a JPG, PNG, or WEBP image.');
    return;
  }
  if (file.size > maxImageBytes) {
    showToast('That image is larger than 8 MB. Choose a smaller file.');
    return;
  }
  const reader = new FileReader();
  reader.onload = event => setPreview(event.target.result, file.name);
  reader.onerror = () => showToast('The image could not be read. Please try again.');
  reader.readAsDataURL(file);
}

async function openCamera() {
  if (state.cameraStream) {
    const context = elements.captureCanvas.getContext('2d');
    elements.captureCanvas.width = elements.cameraVideo.videoWidth;
    elements.captureCanvas.height = elements.cameraVideo.videoHeight;
    context.drawImage(elements.cameraVideo, 0, 0);
    setPreview(elements.captureCanvas.toDataURL('image/jpeg', 0.9), 'camera-capture.jpg');
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    showToast('Camera access is not available in this browser. Upload an image instead.');
    return;
  }
  try {
    state.cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    elements.cameraVideo.srcObject = state.cameraStream;
    elements.cameraVideo.hidden = false;
    elements.imagePreview.hidden = true;
    elements.emptyState.hidden = true;
    elements.clearButton.hidden = false;
    elements.cameraButton.innerHTML = '<span class="button-icon" aria-hidden="true">●</span> Capture frame';
    elements.cameraHint.textContent = 'Frame the food clearly, then capture the image.';
    setStatus('Camera live', 'ready');
  } catch (error) {
    showToast('Camera permission was denied or unavailable. Upload an image instead.');
  }
}

function renderResult(result) {
  const label = typeof result.labelName === 'string' && result.labelName.trim() ? result.labelName : 'Unclassified';
  const confidence = Number(result.confidence);
  const validConfidence = Number.isFinite(confidence) && confidence >= 0 && confidence <= 1;
  const percentage = validConfidence ? Math.round(confidence * 100) : null;
  const confidenceText = percentage === null ? 'Unavailable' : `${percentage}%`;
  const safeLabel = label.replace(/[<>&"']/g, character => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#039;' }[character]));

  elements.resultContent.innerHTML = `
    <div class="result-card">
      <p class="result-label">Predicted condition</p>
      <h3 class="result-name">${safeLabel}</h3>
      <div class="confidence-row"><span>Confidence</span><strong class="confidence-value">${confidenceText}</strong></div>
      <div class="confidence-track" aria-label="Confidence ${confidenceText}"><div class="confidence-fill" style="width: ${percentage ?? 0}%"></div></div>
      <p class="result-meta">${result.labelId ? `Label ID: ${String(result.labelId)}` : 'No label ID returned.'}${result.decisionThreshold !== undefined && result.decisionThreshold !== null ? ` Threshold: ${result.decisionThreshold}` : ''}</p>
    </div>`;
}

function renderError(message) {
  elements.resultContent.innerHTML = `
    <div class="result-placeholder">
      <div class="placeholder-ring">!</div>
      <h3>Inspection did not complete</h3>
      <p>${message}</p>
    </div>`;
}

async function inspectImage() {
  if (!state.imageData || !elements.functionId.value.trim() || state.isInspecting) return;
  const proxyUrl = elements.proxyUrl.value.trim();
  if (!proxyUrl) {
    showToast('Add the backend endpoint that securely calls Nyckel.');
    return;
  }
  state.isInspecting = true;
  updateInspectButton();
  setStatus('Analyzing', 'busy');
  elements.scanLine.hidden = false;
  elements.resultContent.innerHTML = '<div class="result-placeholder"><div class="placeholder-ring">...</div><h3>Reading visual signals</h3><p>Your image is being checked against the configured function.</p></div>';

  try {
    const response = await fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ functionId: elements.functionId.value.trim(), data: state.imageData })
    });
    let payload;
    try { payload = await response.json(); } catch { payload = {}; }
    if (!response.ok) {
      throw new Error(payload.message || payload.error || `The inspection service returned ${response.status}.`);
    }
    if (!Object.prototype.hasOwnProperty.call(payload, 'confidence') && !payload.labelName) {
      throw new Error('The backend did not return a Nyckel FunctionOutput.');
    }
    renderResult(payload);
    setStatus('Complete', 'ready');
  } catch (error) {
    renderError(error.message || 'The inspection service could not be reached.');
    setStatus('Error', 'error');
  } finally {
    state.isInspecting = false;
    elements.scanLine.hidden = true;
    updateInspectButton();
  }
}

elements.fileInput.addEventListener('change', event => readFile(event.target.files[0]));
elements.cameraButton.addEventListener('click', openCamera);
elements.clearButton.addEventListener('click', clearPreview);
elements.inspectButton.addEventListener('click', inspectImage);
elements.functionId.addEventListener('input', updateInspectButton);

elements.mediaStage.addEventListener('dragover', event => {
  event.preventDefault();
  elements.mediaStage.classList.add('drag-over');
});
elements.mediaStage.addEventListener('dragleave', () => elements.mediaStage.classList.remove('drag-over'));
elements.mediaStage.addEventListener('drop', event => {
  event.preventDefault();
  elements.mediaStage.classList.remove('drag-over');
  readFile(event.dataTransfer.files[0]);
});

window.addEventListener('beforeunload', stopCamera);
