// script.js
// Requirements used:
// - PDF.js (rendering preview)
// - pdf-lib (embedding image into PDF and creating output bytes)
// - forge (optional: inspect .p12/.pfx file metadata)
//
// Notes:
// - This script embeds a visual signature image into the PDF (non-cryptographic).
// - Cryptographic PDF signing (PKCS#7/CMS inside PDF) is NOT implemented here — it usually requires server-side signing
//   or a specialized client-side library and careful handling of private keys and certificates.
// - The UI accepts .p12/.pfx and a password and attempts to parse certificate info for inspection only.

(() => {
  // Globals / DOM
  const pdfFileInput = document.getElementById('pdfFile');
  const sigFileInput = document.getElementById('sigFile');
  const sigPasswordInput = document.getElementById('sigPassword');
  const inspectBtn = document.getElementById('inspectP12');
  const togglePlaceBtn = document.getElementById('togglePlace');
  const applyBtn = document.getElementById('applyBtn');
  const statusEl = document.getElementById('status');
  const pdfCanvas = document.getElementById('pdfCanvas');
  const overlayCanvas = document.getElementById('overlayCanvas');
  const ctx = pdfCanvas.getContext('2d');
  const overlayCtx = overlayCanvas.getContext('2d');
  
  const pageIndicator = document.getElementById('pageIndicator');
  const prevPageBtn = document.getElementById('prevPage');
  const nextPageBtn = document.getElementById('nextPage');
  const selectedPageSpan = document.getElementById('selectedPage');
  const selectionInfoPre = document.getElementById('selectionInfo');
  const sigPreview = document.getElementById('sigPreview');
  
  // PDF.js worker setup (use built-in worker src)
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
  
  let pdfDoc = null;
  let currentPageNum = 1;
  let totalPages = 0;
  let scale = 1.0;
  
  // Selection state
  let placing = false; // whether placement mode active
  let isDragging = false;
  let dragStart = null; // {x,y} in canvas pixels
  let dragRect = null; // {x,y,w,h} in canvas pixels
  let selectedPageForSig = null;
  
  // Signature file state
  let signatureImage = null; // HTMLImageElement or null
  let signatureFileRaw = null; // ArrayBuffer of the signature file (image or p12)
  let signatureIsImage = false;
  let p12ParsedInfo = null;
  
  // PDF bytes (original)
  let originalPdfBytes = null;
  
  function setStatus(msg, ok = true) {
    statusEl.textContent = msg;
    statusEl.style.color = ok ? '' : 'var(--danger)';
  }
  
  function resetSelection() {
    dragStart = null;
    dragRect = null;
    selectedPageForSig = null;
    selectionInfoPre.textContent = 'none';
    selectedPageSpan.textContent = '—';
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  }
  
  // Render page using PDF.js
  async function renderPage(pageNum) {
    if (!pdfDoc) return;
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: scale });
    
    // Resize canvases
    pdfCanvas.width = Math.floor(viewport.width);
    pdfCanvas.height = Math.floor(viewport.height);
    
    overlayCanvas.width = pdfCanvas.width;
    overlayCanvas.height = pdfCanvas.height;
    overlayCanvas.style.left = pdfCanvas.offsetLeft + 'px';
    overlayCanvas.style.top = pdfCanvas.offsetTop + 'px';
    overlayCanvas.style.pointerEvents = 'auto';
    
    // Render
    const renderContext = {
      canvasContext: ctx,
      viewport: viewport
    };
    await page.render(renderContext).promise;
    
    pageIndicator.textContent = `${pageNum} / ${totalPages}`;
  }
  
  async function loadPdfFromFile(file) {
    resetSelection();
    setStatus('Loading PDF...');
    const arrayBuffer = await file.arrayBuffer();
    originalPdfBytes = arrayBuffer;
    const typed = new Uint8Array(arrayBuffer);
    pdfDoc = await pdfjsLib.getDocument({ data: typed }).promise;
    totalPages = pdfDoc.numPages;
    currentPageNum = 1;
    await renderPage(currentPageNum);
    setStatus('PDF loaded. Enter placement mode to add signature.');
    applyBtn.disabled = false; // allow applying once PDF is loaded (but signature may not exist)
  }
  
  // Handle signature file
  async function handleSignatureFile(file) {
    resetSignatureState();
    const name = file.name.toLowerCase();
    const ab = await file.arrayBuffer();
    signatureFileRaw = ab;
    
    if (name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.gif')) {
      // load image
      const blob = new Blob([ab], { type: file.type || 'image/png' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        signatureImage = img;
        signatureIsImage = true;
        sigPreview.innerHTML = '';
        sigPreview.appendChild(img);
        setStatus('Signature image loaded. Enter placement mode to place it.');
      };
      img.onerror = () => {
        setStatus('Failed to load signature image.', false);
      };
      img.src = url;
    } else if (name.endsWith('.p12') || name.endsWith('.pfx')) {
      // store raw and show message — optional parsing via forge
      signatureIsImage = false;
      signatureImage = null;
      sigPreview.innerHTML = `<div style="padding:8px;font-size:13px;color:var(--muted)">Loaded .p12/.pfx (certificate store). Click "Inspect .p12" to parse certificate info (password required). Visual signature not auto-derived.</div>`;
      setStatus('.p12/.pfx loaded. You can inspect metadata or load a separate signature image to embed visually.');
      // Keep bytes for inspection
    } else {
      setStatus('Unsupported signature file type. Use PNG/JPG/GIF or .p12/.pfx', false);
    }
  }
  
  function resetSignatureState() {
    signatureImage = null;
    signatureFileRaw = null;
    signatureIsImage = false;
    p12ParsedInfo = null;
    sigPreview.innerHTML = 'No signature loaded';
  }
  
  // Inspect .p12 using forge (best-effort). This does not sign the PDF.
  function inspectP12() {
    if (!signatureFileRaw) { setStatus('Load a .p12/.pfx file first.', false); return; }
    const pass = sigPasswordInput.value || '';
    try {
      const bytes = new Uint8Array(signatureFileRaw);
      // forge expects binary string
      let bstr = '';
      for (let i = 0; i < bytes.length; i++) bstr += String.fromCharCode(bytes[i]);
      const p12Asn1 = forge.asn1.fromDer(bstr);
      const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, pass);
      const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
      const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || [];
      let info = '';
      if (certBags.length === 0 && keyBags.length === 0) {
        info = 'No certs/keys found (or wrong password).';
      } else {
        info += `Certificates: ${certBags.length}\nPrivate keys: ${keyBags.length}\n\n`;
        certBags.forEach((cb, i) => {
          try {
            const cert = cb.cert;
            const subj = cert.subject.attributes.map(a => `${a.shortName}=${a.value}`).join(', ');
            const issuer = cert.issuer.attributes.map(a => `${a.shortName}=${a.value}`).join(', ');
            info += `Cert ${i+1}:\n  Subject: ${subj}\n  Issuer: ${issuer}\n  Valid from: ${cert.validity.notBefore}\n  Valid to: ${cert.validity.notAfter}\n\n`;
          } catch (e) {
            info += `Cert ${i+1}: (could not parse)\n`;
          }
        });
      }
      p12ParsedInfo = info;
      alert('p12 inspection:\n\n' + info);
      setStatus('Parsed .p12/.pfx. (See alert with details). Note: This demo does not perform cryptographic PDF signing.');
    } catch (err) {
      console.error(err);
      setStatus('Failed to parse .p12/.pfx — maybe wrong password or unsupported format.', false);
    }
  }
  
  // Mouse interactions for selecting rectangle on the canvas
  function enablePlacementMode(enable) {
    placing = enable;
    togglePlaceBtn.textContent = enable ? 'Stop placing signature' : 'Start placing signature';
    overlayCanvas.style.pointerEvents = enable ? 'auto' : 'none';
    if (!enable) {
      // stop any dragging
      isDragging = false;
    }
  }
  
  function canvasToRect(start, end) {
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    const w = Math.abs(start.x - end.x);
    const h = Math.abs(start.y - end.y);
    return { x, y, w, h };
  }
  
  function drawOverlay() {
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    
    if (dragRect) {
      overlayCtx.save();
      overlayCtx.strokeStyle = 'rgba(59,130,246,0.95)';
      overlayCtx.lineWidth = 2;
      overlayCtx.setLineDash([6, 4]);
      overlayCtx.strokeRect(dragRect.x + 0.5, dragRect.y + 0.5, dragRect.w, dragRect.h);
      
      overlayCtx.fillStyle = 'rgba(59,130,246,0.08)';
      overlayCtx.fillRect(dragRect.x, dragRect.y, dragRect.w, dragRect.h);
      
      // Draw small handle at bottom-right
      overlayCtx.fillStyle = 'rgba(59,130,246,0.95)';
      overlayCtx.fillRect(dragRect.x + dragRect.w - 10, dragRect.y + dragRect.h - 10, 10, 10);
      overlayCtx.restore();
    }
    
    // If signature image loaded and selection exists, draw small preview inside rect
    if (dragRect && signatureImage) {
      try {
        overlayCtx.drawImage(signatureImage, dragRect.x + 4, dragRect.y + 4, Math.max(0, dragRect.w - 8), Math.max(0, dragRect.h - 8));
      } catch (e) {
        // image might not be ready — ignore
      }
    }
  }
  
  // Convert canvas pixel rect -> PDF points rect for pdf-lib.
  // Need: pageSize (in PDF points) from pdf-lib, and canvas.width/canvas.height (px)
  // PDF coordinate origin is bottom-left; canvas origin is top-left.
  function canvasRectToPdfRect(canvasRect, pdfPageWidth, pdfPageHeight) {
    // compute scale (points per pixel)
    const pxToPt = pdfPageWidth / pdfCanvas.width;
    const x = canvasRect.x * pxToPt;
    const width = canvasRect.w * pxToPt;
    // For Y: convert from top-left to bottom-left
    const yTop = canvasRect.y;
    const height = canvasRect.h * pxToPt;
    const y = pdfPageHeight - (yTop * pxToPt) - height;
    return { x, y, width, height };
  }
  
  // MAIN: apply signature (embed image into PDF and return blob for download)
  async function applySignatureAndDownload() {
    if (!originalPdfBytes) { setStatus('No PDF loaded.', false); return; }
    if (!dragRect || !selectedPageForSig) { setStatus('No selection made. Please place a rectangle on the desired page.', false); return; }
    if (!signatureFileRaw) { setStatus('No signature file loaded. Load an image to embed visually.', false); return; }
    if (!signatureIsImage) {
      // If user only provided .p12, we warn and require an image
      setStatus('A .p12 was loaded but no signature image was provided. Please load a signature image (PNG/JPG) to embed visually.', false);
      return;
    }
    
    setStatus('Applying signature — building new PDF...');
    try {
      const { PDFDocument } = PDFLib;
      const pdfDocLib = await PDFDocument.load(originalPdfBytes);
      const pages = pdfDocLib.getPages();
      // page numbers in pdf-lib are 0-based
      const pageIndex = selectedPageForSig - 1;
      const page = pages[pageIndex];
      const { width: pdfW, height: pdfH } = page.getSize();
      
      // Embed signature image into PDF
      // Convert signatureFileRaw ArrayBuffer into bytes for pdf-lib
      const imgBytes = new Uint8Array(signatureFileRaw);
      // detect type via signatureImage.src? If it's a Blob URL we can check file extension via sigFileInput.files
      const sigFile = sigFileInput.files[0];
      let embeddedImage;
      if (sigFile && /\.(png)$/i.test(sigFile.name)) {
        embeddedImage = await pdfDocLib.embedPng(imgBytes);
      } else {
        // default to JPEG if not PNG
        embeddedImage = await pdfDocLib.embedJpg(imgBytes).catch(async () => {
          // fallback: try PNG embed if JPG failed
          return pdfDocLib.embedPng(imgBytes);
        });
      }
      
      // Convert dragRect to PDF coordinates
      const pdfRect = canvasRectToPdfRect(dragRect, pdfW, pdfH);
      
      // Add the image to the page at calculated size and position
      page.drawImage(embeddedImage, {
        x: pdfRect.x,
        y: pdfRect.y,
        width: pdfRect.width,
        height: pdfRect.height,
      });
      
      // Optionally: Add small text like "Signed with Visual e-sign" with timestamp
      const now = new Date();
      const timestamp = now.toLocaleString();
      page.drawText(`Signed (visual) — ${timestamp}`, {
        x: pdfRect.x,
        y: Math.max(6, pdfRect.y - 14),
        size: 8,
      });
      
      const pdfBytes = await pdfDocLib.save();
      // Create blob and download
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const originalName = (pdfFileInput.files[0] && pdfFileInput.files[0].name) || 'document.pdf';
      a.download = originalName.replace(/\.pdf$/i, '') + '_signed.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStatus('Signed PDF generated and download started.');
    } catch (err) {
      console.error(err);
      setStatus('Failed to apply signature: ' + (err.message || err), false);
    }
  }
  
  // ---- Event Listeners ----
  
  pdfFileInput.addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    await loadPdfFromFile(f);
    resetSelection();
  });
  
  sigFileInput.addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    await handleSignatureFile(f);
  });
  
  inspectBtn.addEventListener('click', () => inspectP12());
  
  togglePlaceBtn.addEventListener('click', () => {
    enablePlacementMode(!placing);
    setStatus(placing ? 'Placement mode enabled. Click and drag on the PDF to create a rectangle.' : 'Placement mode disabled.');
  });
  
  prevPageBtn.addEventListener('click', async () => {
    if (!pdfDoc) return;
    currentPageNum = Math.max(1, currentPageNum - 1);
    await renderPage(currentPageNum);
    resetSelection();
  });
  
  nextPageBtn.addEventListener('click', async () => {
    if (!pdfDoc) return;
    currentPageNum = Math.min(totalPages, currentPageNum + 1);
    await renderPage(currentPageNum);
    resetSelection();
  });
  /*
  applyBtn.addEventListener('click', async () => {
    await applySignatureAndDownload();
  });
  */
  applyBtn.addEventListener('click', async () => {
    // Assume `f` is the selected PDF File object
    // and you have stored user click coordinates as x, y, width, height
    const rect = {
      x: selectedArea.x,
      y: selectedArea.y,
      width: selectedArea.width,
      height: selectedArea.height,
      page: currentPageNumber // optional if multi-page
    };
    
    await signLocally(f, rect);
  });
  
  async function signLocally(file, rect) {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("rect", JSON.stringify(rect));
    
    const res = await fetch("http://localhost:5678/sign", {
      method: "POST",
      body: formData
    });
    
    if (!res.ok) {
      const err = await res.text();
      console.error("Signing failed:", err);
      alert("Signing failed — see console for details");
      return;
    }
    
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "signed.pdf";
    a.click();
  }
  
  // overlayCanvas mouse events
  overlayCanvas.addEventListener('mousedown', (ev) => {
    if (!placing) return;
    isDragging = true;
    const rect = overlayCanvas.getBoundingClientRect();
    dragStart = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
    dragRect = { x: dragStart.x, y: dragStart.y, w: 0, h: 0 };
    selectedPageForSig = currentPageNum;
    selectedPageSpan.textContent = String(selectedPageForSig);
    drawOverlay();
  });
  
  overlayCanvas.addEventListener('mousemove', (ev) => {
    if (!placing) return;
    if (!isDragging) return;
    const rect = overlayCanvas.getBoundingClientRect();
    const pos = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
    dragRect = canvasToRect(dragStart, pos);
    // update selection info
    selectionInfoPre.textContent = `x:${Math.round(dragRect.x)} y:${Math.round(dragRect.y)} w:${Math.round(dragRect.w)} h:${Math.round(dragRect.h)}`;
    drawOverlay();
  });
  
  overlayCanvas.addEventListener('mouseup', (ev) => {
    if (!placing) return;
    if (!isDragging) return;
    isDragging = false;
    if (dragRect && (dragRect.w < 4 || dragRect.h < 4)) {
      // too small — cancel
      dragRect = null;
      setStatus('Selection canceled (too small).', false);
    } else {
      setStatus('Selection set. You can place another selection or click "Apply & Download Signed PDF".');
      selectedPageForSig = currentPageNum;
      selectedPageSpan.textContent = String(selectedPageForSig);
      selectionInfoPre.textContent = `x:${Math.round(dragRect.x)} y:${Math.round(dragRect.y)} w:${Math.round(dragRect.w)} h:${Math.round(dragRect.h)}`;
      // keep overlay visible (so user can preview)
    }
    drawOverlay();
  });
  
  // Support leaving mouse outside canvas (stop dragging)
  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      drawOverlay();
    }
  });
  
  // When the window resizes, re-render current page to adjust canvas size
  window.addEventListener('resize', async () => {
    if (pdfDoc) {
      // recompute scale to fit container width nicely (optional)
      // For simplicity keep scale constant (1.0) — user can refresh or reload for different scale
      await renderPage(currentPageNum);
      drawOverlay();
    }
  });
  // helper: when user navigates pages we must clear selection if it belonged to another page
  // that's handled in page change (resetSelection called on page load)
  
  // initial status
  setStatus('Ready — load a PDF to begin.');
})();