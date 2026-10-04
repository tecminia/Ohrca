/* ORÇA SINAPI — login com Google (Firebase Auth). Arquivo separado, usado por index.html e admin.html.
   Todo acesso a dados passa pelo Worker: nada aqui fala direto com o Firestore. */
(function () {
  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyBYD96uL6TMNZ3u37tKImR14DD08wZ9yRw",
    authDomain: "ohrca-5bfc2.firebaseapp.com",
    projectId: "ohrca-5bfc2",
    storageBucket: "ohrca-5bfc2.firebasestorage.app",
    messagingSenderId: "938142914062",
    appId: "1:938142914062:web:9dcacd26cf867b24090e5f"
  };
  const API = 'https://ohrca.tecminia.workers.dev';
  const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
  const load = (src) => new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => no(new Error('Falha ao carregar ' + src)); document.head.appendChild(s); });
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const CSS = `#ol{position:fixed;inset:0;z-index:999;display:grid;place-items:center;background:var(--bg,#f4f3ee);color:var(--ink,#1c2326);font:14px/1.45 'IBM Plex Sans',system-ui,sans-serif}
#ol .bx{background:var(--pn,#fff);border:1px solid var(--ln,#dcd9ce);border-radius:12px;padding:32px 30px;width:380px;max-width:92vw;text-align:center;box-shadow:0 12px 40px rgba(0,0,0,.12)}
#ol img{height:84px;margin-bottom:10px}#ol h1{font-size:20px;margin:0 0 4px}#ol p{color:var(--mu,#697378);margin:0 0 20px}
#ol button{font:inherit;cursor:pointer;width:100%;padding:11px 14px;border-radius:8px;border:1px solid var(--ln,#dcd9ce);background:var(--pn,#fff);color:inherit;font-weight:500;display:flex;gap:10px;align-items:center;justify-content:center}
#ol button:hover{border-color:var(--ac,#0f5c4d)}#ol button.s{margin-top:10px;border:0;background:none;color:var(--mu,#697378);font-weight:400}
#ol .er{color:var(--er,#b3261e);margin-top:14px;min-height:18px;font-size:13px}#ol.adm .bx{border-top:4px solid var(--ac,#0f5c4d)}`;
  const G = '<svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6.1C12.3 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z"/><path fill="#FBBC05" d="M10.4 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.9-4.7l-7.8-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.8-6.1z"/><path fill="#34A853" d="M24 48c6.2 0 11.5-2 15.3-5.6l-7.5-5.8c-2 1.4-4.7 2.3-7.8 2.3-6.3 0-11.7-4.1-13.6-9.8l-7.8 6.1C6.5 42.6 14.6 48 24 48z"/></svg>';

  const A = { me: null, user: null, auth: null };
  let opts = {}, overlay = null;

  function show(html, onGoogle) {
    if (!overlay) { const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st); overlay = document.createElement('div'); overlay.id = 'ol'; document.body.appendChild(overlay); }
    overlay.className = opts.admin ? 'adm' : '';
    overlay.style.display = 'grid';
    overlay.innerHTML = `<div class="bx">${opts.logo ? `<img src="${opts.logo}" alt="">` : ''}${html}</div>`;
    const g = overlay.querySelector('[data-g]'); if (g) g.onclick = onGoogle;
    const o = overlay.querySelector('[data-o]'); if (o) o.onclick = () => A.auth.signOut();
  }
  const hide = () => { if (overlay) overlay.style.display = 'none'; };
  const loginView = (msg) => show(`<h1>${esc(opts.title)}</h1><p>${esc(opts.subtitle)}</p><button data-g>${G} Entrar com Google</button><div class="er" id="oe">${esc(msg || '')}</div>`, signIn);

  async function signIn() {
    const er = document.getElementById('oe'); if (er) er.textContent = '';
    const prov = new firebase.auth.GoogleAuthProvider(); prov.setCustomParameters({ prompt: 'select_account' });
    try { await A.auth.signInWithPopup(prov); }
    catch (e) {
      if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'].includes(e.code)) return A.auth.signInWithRedirect(prov);
      if (er && !['auth/popup-closed-by-user', 'auth/cancelled-popup-request'].includes(e.code)) er.textContent = e.code === 'auth/unauthorized-domain' ? 'Domínio não autorizado no Firebase (Authentication > Settings > Authorized domains).' : 'Não foi possível entrar. Tente novamente.';
    }
  }

  async function api(path, o = {}, retried) {
    if (!A.user) throw Object.assign(new Error('auth'), { status: 401 });
    const tok = await A.user.getIdToken(!!retried);
    const r = await fetch(API + '/api' + path, { method: o.method || 'GET', headers: { authorization: 'Bearer ' + tok, ...(o.body ? { 'content-type': 'application/json' } : {}) }, body: o.body ? JSON.stringify(o.body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && !retried) return api(path, o, true);
    if (!r.ok) throw Object.assign(new Error(j.error || 'erro'), { status: r.status, data: j });
    return j;
  }

  async function start(o) {
    opts = Object.assign({ admin: false, title: 'Orça SINAPI', subtitle: 'Entre com sua conta Google para continuar.', logo: '', onReady() {} }, o);
    try { await load(SDK + 'firebase-app-compat.js'); await load(SDK + 'firebase-auth-compat.js'); }
    catch (e) { show(`<h1>Sem conexão</h1><p>Não foi possível carregar o serviço de login. Verifique a internet.</p>`); return; }
    // Login administrativo usa um app Firebase separado, com sessão que expira ao fechar a aba.
    const app = firebase.initializeApp(FIREBASE_CONFIG, opts.admin ? 'admin' : undefined);
    A.auth = app.auth();
    await A.auth.setPersistence(opts.admin ? firebase.auth.Auth.Persistence.SESSION : firebase.auth.Auth.Persistence.LOCAL);
    let started = false;
    A.auth.onAuthStateChanged(async (u) => {
      A.user = u; A.me = null;
      if (!u) { started = false; loginView(); return; }
      show(`<h1>Entrando…</h1><p>${esc(u.email)}</p>`);
      try {
        const me = await api('/me');
        if (me.profile.blocked) return show(`<h1>Conta bloqueada</h1><p>O acesso desta conta foi suspenso. Entre em contato com o suporte.</p><button data-o>Sair</button>`);
        if (opts.admin && !me.admin) return show(`<h1>Sem permissão</h1><p>${esc(u.email)} não tem acesso administrativo.</p><button data-o>Entrar com outra conta</button>`);
        A.me = me; hide();
        if (!started) { started = true; opts.onReady({ uid: u.uid, email: u.email, me }); }
      } catch (e) { show(`<h1>Erro de conexão</h1><p>Não foi possível falar com o servidor (${esc(e.message)}).</p><button data-g>Tentar novamente</button><button class="s" data-o>Sair</button>`, () => location.reload()); }
    });
  }
  window.OhrcaAuth = { start, api, signOut: () => A.auth && A.auth.signOut(), get me() { return A.me; }, get user() { return A.user; }, API };
})();
