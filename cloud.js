/* ORÇA SINAPI — recursos de nuvem do app: sincronização, base SINAPI, moedas, compra e compressão de mídia.
   Depende de auth.js (OhrcaAuth.api). Nunca fala direto com o Firestore. */
(function () {
  const api = (p, o) => OhrcaAuth.api(p, o);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const brl = (n) => Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
  const C = { me: null, cfg: null, uid: '', toast: () => {}, coins: 0, unlimited: false };

  /* ---------- Mídia: reduzir resolução -> WebP -> Base64 ---------- */
  const loadImg = (src) => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('Imagem inválida')); i.src = src; });
  const readURL = (f) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(f); });
  async function shrink(src, max, mime, q, flat) {
    const im = await loadImg(src), k = Math.min(1, max / Math.max(im.width, im.height)), c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(im.width * k)); c.height = Math.max(1, Math.round(im.height * k));
    const g = c.getContext('2d'); if (flat) { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); }
    g.drawImage(im, 0, 0, c.width, c.height);
    return c.toDataURL(mime, q);
  }
  async function webp(src, max, q, flat) { // navegadores sem encoder WebP caem para JPEG (o Worker aceita ambos)
    const o = await shrink(src, max, 'image/webp', q, flat);
    return o.startsWith('data:image/webp') ? o : shrink(src, max, 'image/jpeg', q, true);
  }
  async function fitWebp(src, maxChars, dim) {
    let d = dim, q = 0.8;
    for (let i = 0; i < 8; i++) { const o = await webp(src, d, q, true); if (o.length <= maxChars) return o; q = Math.max(0.4, q - 0.1); d = Math.round(d * 0.8); }
    throw new Error('Imagem grande demais mesmo após compactar.');
  }
  const loadScript = (src) => new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = no; document.head.appendChild(s); });
  async function pdfToImgs(file) { // PDFs não têm WebP: renderiza as primeiras páginas como imagem e compacta
    const V = '3.11.174', B = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/' + V + '/';
    if (!window.pdfjsLib) await loadScript(B + 'pdf.min.js');
    pdfjsLib.GlobalWorkerOptions.workerSrc = B + 'pdf.worker.min.js';
    const doc = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise, out = [];
    for (let i = 1; i <= Math.min(2, doc.numPages); i++) {
      const pg = await doc.getPage(i), v0 = pg.getViewport({ scale: 1 }), v = pg.getViewport({ scale: Math.min(2, 1100 / Math.max(v0.width, v0.height)) });
      const c = document.createElement('canvas'); c.width = v.width; c.height = v.height;
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      await pg.render({ canvasContext: g, viewport: v }).promise; out.push(c.toDataURL('image/png'));
    }
    return out;
  }
  async function receiptImgs(file) {
    if (file.size > 15e6) throw new Error('Arquivo maior que 15 MB.');
    const srcs = file.type === 'application/pdf' ? await pdfToImgs(file) : /^image\//.test(file.type) ? [await readURL(file)] : null;
    if (!srcs) throw new Error('Envie uma imagem ou PDF.');
    return Promise.all(srcs.map((s) => fitWebp(s, 270000, 1100)));
  }
  const logoLocal = async (file) => shrink(await readURL(file), 300, 'image/png', 1, false); // local: PNG (ExcelJS/jsPDF não leem WebP)

  /* ---------- Sincronização de projetos (dados dos formulários) ---------- */
  let busy = false, dirty = false;
  const SK = () => 'orcasinapi_sync_' + C.uid;
  async function push(getP) {
    if (busy) { dirty = true; return; }
    busy = true;
    try {
      const P = getP(), sy = lsGet(SK()) || {};
      for (const id of Object.keys(P.items)) {
        const p = P.items[id], up = p.upd; if ((sy[id] || 0) >= up) continue;
        const d = Object.assign({}, p.data);
        for (const k of ['logoE', 'logoD']) if (d[k]) d[k] = await webp(d[k], 300, 0.8, false);
        await api('/projects/' + id, { method: 'PUT', body: { upd: up, arq: !!p.arq, json: JSON.stringify(d) } });
        sy[id] = up;
      }
      for (const id of Object.keys(sy)) if (!P.items[id]) { await api('/projects/' + id, { method: 'DELETE' }); delete sy[id]; }
      localStorage.setItem(SK(), JSON.stringify(sy));
    } catch (e) { if (e.message === 'project_too_large') C.toast('Um projeto é grande demais para a nuvem (limite ~900 KB). Reduza logos/itens.'); }
    finally { busy = false; if (dirty) { dirty = false; push(getP); } }
  }
  async function pull(P) {
    const r = await api('/projects'), sy = lsGet(SK()) || {}; let n = 0;
    for (const it of r.items) {
      const l = P.items[it.id];
      if (l && l.upd >= it.upd) { if (l.upd === it.upd) sy[it.id] = it.upd; continue; }
      if (!l && sy[it.id] !== undefined) continue; // apagado localmente
      const d = await api('/projects/' + it.id), data = JSON.parse(d.json);
      for (const k of ['logoE', 'logoD']) if (data[k]) data[k] = await shrink(data[k], 300, 'image/png', 1, false).catch(() => null);
      P.items[it.id] = { id: it.id, arq: !!d.arq, upd: it.upd, data }; sy[it.id] = it.upd; n++;
    }
    localStorage.setItem(SK(), JSON.stringify(sy));
    return n;
  }

  /* ---------- Base SINAPI exportada (gzip + Base64 em blocos) ---------- */
  const CH = 750000, BP = (sh, w) => (sh ? (w ? '/admin/sbase' : '/sbase') : '/base'); // própria: /base · compartilhada: leitura /sbase, escrita /admin/sbase
  async function saveBase(d, sh) {
    const json = JSON.stringify({ ref: d.ref, emi: d.emi, ufs: d.ufs, items: d.items, an: d.an }, (k, v) => (k === 's' ? undefined : v));
    const buf = new Uint8Array(await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
    let s = ''; for (let i = 0; i < buf.length; i += 32768) s += String.fromCharCode.apply(null, buf.subarray(i, i + 32768));
    const b64 = btoa(s), total = Math.ceil(b64.length / CH);
    if (total > 40) throw new Error('Base grande demais para a nuvem.');
    for (let i = 0; i < total; i++) { C.toast(`Enviando base à nuvem… ${i + 1}/${total}`); await api(BP(sh, 1) + '/' + i, { method: 'PUT', body: { d: b64.slice(i * CH, (i + 1) * CH) } }); }
    await api(BP(sh, 1) + '/commit', { method: 'POST', body: { ref: String(d.ref || ''), emi: String(d.emi || ''), ufs: d.ufs, total, bytes: b64.length } });
    C.toast(sh ? 'Base compartilhada publicada' : 'Base SINAPI salva na nuvem');
  }
  const baseMeta = (sh) => api(BP(sh)).catch(() => null);
  async function loadBase(sh) {
    const m = await api(BP(sh)); if (m.none) return null;
    let b64 = ''; for (let i = 0; i < m.total; i++) { C.toast(`Baixando base da nuvem… ${i + 1}/${m.total}`); b64 += (await api(BP(sh) + '/' + i)).d; }
    const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return JSON.parse(await new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
  }

  /* ---------- Moedas ---------- */
  const price = (p) => (p.price != null ? p.price : Math.round(p.coins * C.cfg.coinPrice * 100) / 100);
  function setCoins(n) { C.coins = n; draw(); }
  function draw() {
    const el = document.getElementById('coins'); if (!el) return;
    el.innerHTML = C.unlimited ? '<span class="cd">∞</span> ilimitado' : `<span class="cd">●</span> <b>${C.coins}</b> moedas`;
    el.title = `Excel: ${C.cfg.costXlsx} moedas · PDF: ${C.cfg.costPdf} moedas` + (C.unlimited ? '' : ' — clique para comprar');
  }
  const NEED = { xlsx: () => window.ExcelJS, pdf: () => window.jspdf && window.jspdf.jsPDF };
  async function run(kind, fn) {
    if (!NEED[kind]()) { C.toast('Biblioteca não carregada. Verifique a conexão e recarregue.'); return; }
    let r;
    try { r = await api('/consume', { method: 'POST', body: { kind } }); }
    catch (e) {
      if (e.status === 402) { setCoins(e.data.coins); C.toast(`Saldo insuficiente: este arquivo custa ${e.data.cost} moedas e você tem ${e.data.coins}.`); open(); }
      else C.toast(e.status === 403 ? 'Conta bloqueada ou sem permissão.' : 'Não foi possível validar a cobrança. Tente novamente.');
      return;
    }
    setCoins(r.coins);
    try { return await fn(); }
    catch (e) {
      if (r.ticket) try { const f = await api('/refund', { method: 'POST', body: { ticket: r.ticket } }); setCoins(f.coins); C.toast('Falha ao gerar o arquivo — moedas devolvidas.'); } catch (_) {}
      throw e;
    }
  }

  /* ---------- Compra de moedas ---------- */
  const ST = { pending: 'em análise', approved: 'aprovada', rejected: 'recusada' };
  async function open() {
    if (C.unlimited) return;
    document.getElementById('cvov')?.remove();
    const cfg = C.cfg = await api('/config').catch(() => C.cfg), ov = document.createElement('div');
    ov.id = 'cvov'; ov.className = 'cvov';
    const pk = cfg.packages.map((p, i) => `<label class="cvp"><input type="radio" name="cvpk" value="${p.coins}" ${i === 0 ? 'checked' : ''}><span><b>${p.coins} moedas</b></span><span class="cd">${brl(price(p))}</span></label>`).join('');
    ov.innerHTML = `<div class="mdl" style="width:480px"><h2>Comprar moedas</h2><p class="sub" style="margin:2px 0 12px">Saldo atual: <b>${C.coins}</b> · Excel ${cfg.costXlsx} moedas · PDF ${cfg.costPdf} moedas</p>
<div class="cvg">${pk}</div>
<div class="cvx"><b>Como pagar</b><br>${cfg.pixKey ? `PIX: <code id="cvpx">${esc(cfg.pixKey)}</code> <button class="g" id="cvcp">copiar</button><br>` : '<span class="wr">Chave PIX ainda não configurada.</span><br>'}${cfg.pixName ? 'Favorecido: ' + esc(cfg.pixName) + '<br>' : ''}${cfg.payInfo ? `<span style="white-space:pre-wrap">${esc(cfg.payInfo)}</span><br>` : ''}${cfg.support ? 'Suporte: ' + esc(cfg.support) : ''}</div>
<label style="margin-top:12px">Comprovante do pagamento (imagem ou PDF)<input type="file" id="cvf" accept="image/*,application/pdf"></label>
<p class="sub" style="font-size:12px;margin:8px 0">As moedas são liberadas assim que o comprovante é enviado. O comprovante é conferido depois: se for inválido, a compra é recusada, as moedas são retiradas e a conta pode ser bloqueada.</p>
<div id="cvh"></div><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px"><button id="cvc">Fechar</button><button class="p" id="cvs">Enviar comprovante e liberar moedas</button></div></div>`;
    document.body.appendChild(ov);
    const $ = (s) => ov.querySelector(s);
    $('#cvc').onclick = () => ov.remove(); ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
    const cp = $('#cvcp'); if (cp) cp.onclick = () => navigator.clipboard?.writeText(cfg.pixKey).then(() => C.toast('Chave PIX copiada'));
    api('/purchases').then((r) => { if (r.items.length) $('#cvh').innerHTML = '<p class="sub" style="font-size:12px;margin:0">Suas compras: ' + r.items.slice(0, 5).map((x) => `${x.coins} moedas (${ST[x.status] || esc(x.status)})`).join(' · ') + '</p>'; }).catch(() => {});
    $('#cvs').onclick = async () => {
      const f = $('#cvf').files[0], coins = +ov.querySelector('input[name=cvpk]:checked').value;
      if (!f) return C.toast('Anexe o comprovante do pagamento.');
      const b = $('#cvs'); b.disabled = true; b.textContent = 'Compactando e enviando…';
      try { const receipt = await receiptImgs(f), r = await api('/purchase', { method: 'POST', body: { coins, receipt } }); setCoins(r.coins); ov.remove(); C.toast('Moedas liberadas! Seu comprovante será conferido pelo administrador.'); }
      catch (e) { b.disabled = false; b.textContent = 'Enviar comprovante e liberar moedas'; C.toast(e.message === 'too_many_pending' ? 'Você já tem 3 compras em análise. Aguarde a conferência.' : 'Não foi possível enviar: ' + e.message); }
    };
  }

  function init(o) {
    Object.assign(C, { uid: o.uid, me: o.me, cfg: o.me.config, toast: o.toast, coins: o.me.profile.coins, unlimited: o.me.unlimited });
    const st = document.createElement('style');
    st.textContent = `#coins{font:12px 'IBM Plex Mono',monospace;border:1px solid var(--ln);background:var(--ac2);color:var(--ac);padding:4px 11px;border-radius:99px;cursor:pointer;white-space:nowrap}#coins .cd{color:inherit}
#usr{font-size:12px;color:var(--mu);display:flex;gap:8px;align-items:center;white-space:nowrap}#usr a{color:var(--ac);text-decoration:none}
.cvov{position:fixed;inset:0;background:rgba(0,0,0,.45);display:grid;place-items:center;z-index:60}.cvg{display:grid;gap:6px}.cvp{display:flex;gap:10px;align-items:center;justify-content:space-between;border:1px solid var(--ln);border-radius:6px;padding:8px 10px;cursor:pointer;font-size:13px;color:var(--ink)}
.cvp input{width:auto;margin:0}.cvp span:nth-child(2){flex:1}.cvx{margin-top:12px;padding:10px;border:1px dashed var(--ln);border-radius:6px;font-size:13px;color:var(--ink)}.cvx code{font-family:'IBM Plex Mono',monospace;word-break:break-all}`;
    document.head.appendChild(st);
    const u = document.getElementById('usr');
    if (u) { u.innerHTML = `<span>${esc(o.me.profile.email)}</span>${o.me.admin ? '<a href="admin.html">Admin</a>' : ''}<button class="g" id="cvout">Sair</button>`; u.querySelector('#cvout').onclick = () => OhrcaAuth.signOut(); }
    const c = document.getElementById('coins'); if (c) c.onclick = open;
    draw();
  }
  window.Cloud = { init, run, push, pull, saveBase, loadBase, baseMeta, open, logoLocal, get cfg() { return C.cfg; } };
})();
