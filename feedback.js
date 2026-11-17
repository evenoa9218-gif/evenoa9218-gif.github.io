/**
 * feedback.js — 모든 앱 공용 「의견 보내기」
 *
 * 허브에 한 벌만 두고 각 앱이 불러 쓴다. 고칠 때 여기 한 곳만 고치면 된다.
 *
 *   <script src="/feedback.js?v=3" defer data-app="CASE"></script>
 *
 *   data-app      HUB · MCQ · CASE · RECORD · NOTES (워커가 이 목록만 받는다)
 *   data-button   "off" 면 단추를 안 띄운다 — 앱이 제 창구를 갖고 있을 때(MCQ).
 *                 그때는 window.LawFeedback.send({kind, text, ctx}) 로 글만 흘려보낸다.
 *   data-bottom   단추를 바닥에서 얼마나 띄울지(px). 바닥에 다른 단추가 있는 화면용.
 *
 * ⚠ 통합사이트(허브 + 위성 앱 넷) 전용이다. 율리(법조윤리)는 별개 앱이라 여기에 섞지 않는다.
 *
 * 받는 곳은 채점 워커의 /feedback → D1. 읽는 법은 CASE_Practice/worker 의 `npm run feedback`
 * 또는 허브의 /feedback-admin.html.
 *
 * ⚠ 그림자 DOM 안에 그린다. 앱마다 전역 CSS 가 달라서(`textarea{min-height:300px}` 등)
 *   그냥 붙이면 앱 스타일이 덮어쓴다.
 * ⚠ 글자판 이벤트를 밖으로 내보내지 않는다. 그림자 DOM 밖에서 보면 e.target 이
 *   textarea 가 아니라 껍데기 div 라서, 앱의 단축키(암기장 ←→ 등)가 「입력 중」인 줄
 *   모르고 그대로 먹는다.
 */
(function () {
  'use strict';
  if (window.LawFeedback) return;                 // 두 번 불려도 한 번만

  var ENDPOINT = 'https://case-grader.bar-exam.workers.dev/feedback';
  var DRAFT_KEY = 'law_fb_draft';
  var MAX = 3000;

  var me = document.currentScript;
  var ds = (me && me.dataset) || {};
  var seg = (location.pathname.split('/')[1] || '').toLowerCase();
  var APP = (ds.app || { mcq: 'MCQ', case_practice: 'CASE', record_practice: 'RECORD',
    core_notes: 'NOTES' }[seg] || 'HUB').toUpperCase();

  // ── 보고 있던 화면 ─────────────────────────────────────
  // 「채점 칸이 작다」는 말만 와서는 어느 화면인지 모른다. 주소와 눈에 보이는 제목을 같이 보낸다.
  // 답안·문제 본문은 보내지 않는다 — 제목 몇 줄뿐이다.
  function visible(el) {
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
  }
  function context(extra) {
    var heads = [];
    try {
      var els = document.querySelectorAll('h1,h2,h3,.title,[data-fb]');
      for (var i = 0; i < els.length && heads.length < 4; i++) {
        if (!visible(els[i])) continue;
        var t = (els[i].textContent || '').replace(/\s+/g, ' ').trim().slice(0, 70);
        if (t && heads.indexOf(t) < 0) heads.push(t);
      }
    } catch (e) {}
    var c = {
      path: (location.pathname + location.search + location.hash).slice(0, 300),
      title: document.title.slice(0, 80),
      heads: heads, vw: innerWidth, vh: innerHeight, theme: isDark() ? 'dark' : 'light',
    };
    // 앱이 더 알려 줄 것이 있으면(지금 문항 번호 등) window.FEEDBACK_CONTEXT 로 준다
    try { if (typeof window.FEEDBACK_CONTEXT === 'function') c.app = window.FEEDBACK_CONTEXT(); } catch (e) {}
    if (extra) c.extra = extra;
    return c;
  }
  function userId() {
    try { return localStorage.getItem('lawhub_uid') || localStorage.getItem('hub_last_uid') || ''; }
    catch (e) { return ''; }
  }
  // 앱마다 어두운 화면을 켜는 방식이 다르다(data-theme · 클래스 · 변수). 바탕색을 직접 잰다.
  function isDark() {
    try {
      var bg = getComputedStyle(document.body).backgroundColor;
      if (!bg || /rgba?\(0, 0, 0, 0\)|transparent/.test(bg)) bg = getComputedStyle(document.documentElement).backgroundColor;
      var m = bg.match(/\d+(\.\d+)?/g);
      if (!m || m.length < 3) return false;
      return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255 < 0.42;
    } catch (e) { return false; }
  }

  // 의견을 보낸 브라우저의 표식 — 관리자 답장을 이 브라우저에 띄울 때 쓴다.
  // 통합사이트 앱 다섯 곳이 한 출처라 어느 앱에서 보내도, 어느 앱에 들어와도 같은 표식이다.
  // 이름·기기 정보가 아니라 무작위 글자다. 의견을 처음 보낼 때 만든다.
  var CID_KEY = 'law_fb_cid';
  function cidOf(make) {
    try {
      var c = localStorage.getItem(CID_KEY) || '';
      if (/^[a-z0-9]{16,40}$/.test(c)) return c;
      if (!make) return '';
      var a = new Uint8Array(12); crypto.getRandomValues(a);
      c = Array.prototype.map.call(a, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
      localStorage.setItem(CID_KEY, c);
      return c;
    } catch (e) { return ''; }
  }

  // ── 보내기 ────────────────────────────────────────────
  function send(o) {
    var text = String((o && o.text) || '').trim().slice(0, MAX);
    if (text.length < 2) return Promise.reject(new Error('내용을 적어 주세요'));
    return fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app: (o.app || APP), kind: o.kind || '기타', text: text,
        contact: (o.contact || '').slice(0, 120), user: userId(), ctx: context(o.ctx), cid: cidOf(true),
      }),
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(j.error || ('보내지 못했습니다 (' + r.status + ')'));
        return j;
      });
    });
  }
  window.LawFeedback = { send: send, open: function () {}, app: APP };

  // ── 관리자 답장 ───────────────────────────────────────
  // 의견을 보낸 사람이 다시 들어오면(어느 앱이든) 아직 확인 안 한 답장을 카드로 띄운다.
  // 단추를 숨긴 앱(MCQ)에서도 띄운다 — 그래서 단추와 따로 그린다.
  // 의견을 보낸 적 없는 사람(표식도 로그인 ID 도 없음)은 묻지도 않는다.
  //
  // ⚠ 처음에는 **페이지를 열 때 한 번만** 물었다. 그래서 답장이 안 닿았다(2026-11-17):
  //   · 앱은 한 번 열면 새로 고침 없이 오래 쓴다 — 그동안 온 답장은 영영 안 뜬다
  //   · 폰 홈 화면 앱은 다시 띄워도 페이지를 새로 열지 않는다
  //   · 로그인 전에 뜬 페이지는 ID 가 없어 묻지 않고 끝났다
  //   · 3분 제한 시각을 묻기 **전에** 적어, 요청이 실패해도 3분 동안 다시 안 물었다
  // 지금은 열 때 · 화면으로 돌아올 때 · 켜 둔 동안 90초마다 · 로그인 ID 가 생기거나 바뀔 때 묻는다.
  var REPLY_CHECK_KEY = 'law_fb_rchk2';
  var replyBusy = false, lastWho = null;
  // × 로 닫은 답장은 이 탭을 쓰는 동안 다시 띄우지 않는다(다음에 들어오면 다시 뜬다). 「확인」을 눌러야 끝난다.
  function later() { try { return JSON.parse(sessionStorage.getItem('law_fb_later') || '[]'); } catch (e) { return []; } }
  function checkReplies(force) {
    var cid = cidOf(false), uid = userId();
    if (!cid && !uid) return;
    if (replyBusy || document.getElementById('law-feedback-reply')) return;   // 묻는 중이거나 카드가 떠 있다
    var who = cid + '|' + uid;
    if (!force) {
      try {
        var saved = (localStorage.getItem(REPLY_CHECK_KEY) || '').split('@');
        if (saved[0] === who && Date.now() - (+saved[1] || 0) < 90 * 1000) return;
      } catch (e) {}
    }
    replyBusy = true;
    fetch(ENDPOINT + '/inbox?cid=' + encodeURIComponent(cid) + '&uid=' + encodeURIComponent(uid), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (j) {
        try { localStorage.setItem(REPLY_CHECK_KEY, who + '@' + Date.now()); } catch (e) {}   // 성공했을 때만 적는다
        var list = (j.replies || []).filter(function (x) { return later().indexOf(x.id) < 0; });
        if (list.length && !document.getElementById('law-feedback-reply')) showReplies(list, cid, uid);
      })
      .catch(function () {})
      .then(function () { replyBusy = false; });
  }
  function watchReplies() {
    setTimeout(checkReplies, 1200);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) checkReplies(); });
    window.addEventListener('focus', function () { checkReplies(); });
    window.addEventListener('pageshow', function () { checkReplies(); });
    setInterval(function () {
      if (document.hidden) return;
      var who = cidOf(false) + '|' + userId();
      if (who !== lastWho) { lastWho = who; checkReplies(true); }        // 로그인했거나 사용자가 바뀌었다
      else checkReplies();                                               // 90초 제한 안에서
    }, 5000);
  }
  function showReplies(list, cid, uid) {
    var h = document.createElement('div');
    h.id = 'law-feedback-reply';
    var r = h.attachShadow({ mode: 'open' });
    r.innerHTML =
      '<style>:host{all:initial}' +
      '*{box-sizing:border-box;font-family:system-ui,-apple-system,"Malgun Gothic","Apple SD Gothic Neo",sans-serif}' +
      '.c{--bg:#fff;--tx:#1f2d3a;--tx2:#5b6b7a;--bd:#c9d6e2;--ac:#2f5d8a;--acTx:#fff;--sf:#f2f6fa}' +
      '.c.dark{--bg:#1f2731;--tx:#e6edf3;--tx2:#9aa9b8;--bd:#3a4654;--ac:#7fb0de;--acTx:#10202e;--sf:#2a3440}' +
      '.c{position:fixed;right:14px;bottom:' + (Math.max(0, parseInt(ds.bottom, 10) || 14) + 52) + 'px;z-index:2147483002;' +
        'width:min(380px,calc(100vw - 28px));max-height:70vh;overflow-y:auto;background:var(--bg);color:var(--tx);' +
        'border:1px solid var(--ac);border-radius:14px;padding:14px 15px 12px;box-shadow:0 14px 44px rgba(0,0,0,.3)}' +
      '.top{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}' +
      '.top b{font-size:15px;color:var(--ac)}' +
      '.x{border:0;background:none;color:var(--tx2);font-size:20px;line-height:1;cursor:pointer;padding:4px 6px;border-radius:6px}' +
      '.mine{font-size:12.5px;line-height:1.6;color:var(--tx2);background:var(--sf);border-radius:8px;padding:7px 9px;' +
        'white-space:pre-wrap;word-break:break-word;max-height:7.5em;overflow:hidden}' +
      '.lab{font-size:11.5px;color:var(--tx2);margin:9px 0 3px}' +
      '.rep{font-size:14.5px;line-height:1.75;white-space:pre-wrap;word-break:break-word}' +
      '.row{display:flex;justify-content:space-between;align-items:center;margin-top:12px;gap:8px}' +
      '.n{font-size:11.5px;color:var(--tx2)}' +
      '.ok{min-height:38px;padding:0 18px;border-radius:10px;border:0;background:var(--ac);color:var(--acTx);font-size:14px;font-weight:600;cursor:pointer}' +
      '@media print{.c{display:none!important}}</style>' +
      '<div class="c" role="dialog" aria-label="관리자 답장">' +
        '<div class="top"><b>💬 관리자 답장</b><button class="x" type="button" aria-label="나중에 보기">×</button></div>' +
        '<div class="lab"></div><div class="mine"></div>' +
        '<div class="lab">답장</div><div class="rep"></div>' +
        '<div class="row"><span class="n"></span><button class="ok" type="button">확인</button></div>' +
      '</div>';
    var q = function (s) { return r.querySelector(s); };
    var labs = r.querySelectorAll('.lab');
    var i = 0;
    function draw() {
      var it = list[i];
      q('.c').className = 'c' + (isDark() ? ' dark' : '');
      labs[0].textContent = '보내신 의견 (' + (it.kind || '') + (it.ts ? ' · ' + String(it.ts).slice(0, 10) : '') + ')';
      q('.mine').textContent = it.text || '';          // 남이 쓴 글 — textContent 만
      q('.rep').textContent = it.reply || '';
      q('.n').textContent = list.length > 1 ? (i + 1) + ' / ' + list.length : '';
    }
    q('.x').addEventListener('click', function () {                  // 확인 안 하면 다음에 들어올 때 또 뜬다
      try { sessionStorage.setItem('law_fb_later', JSON.stringify(later().concat(list.slice(i).map(function (x) { return x.id; })))); } catch (e) {}
      h.remove();
    });
    q('.ok').addEventListener('click', function () {
      var it = list[i];
      fetch(ENDPOINT + '/inbox', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: it.id, cid: cid, uid: uid }) }).catch(function () {});
      i++;
      if (i < list.length) draw(); else h.remove();
    });
    ['keydown', 'keyup', 'keypress'].forEach(function (t) { r.addEventListener(t, function (e) { e.stopPropagation(); }); });
    draw();
    document.body.appendChild(h);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchReplies); else watchReplies();

  if (ds.button === 'off') return;                // 창구만 열어 두고 단추는 안 그린다

  // ── 화면 ──────────────────────────────────────────────
  var host = document.createElement('div');
  host.id = 'law-feedback';
  var root = host.attachShadow({ mode: 'open' });
  var bottom = Math.max(0, parseInt(ds.bottom, 10) || 14);

  root.innerHTML =
    '<style>' +
    ':host{all:initial}' +
    '*{box-sizing:border-box;font-family:system-ui,-apple-system,"Malgun Gothic","Apple SD Gothic Neo",sans-serif}' +
    '.w{--bg:#fff;--tx:#1f2d3a;--tx2:#5b6b7a;--bd:#c9d6e2;--ac:#2f5d8a;--acTx:#fff;--sf:#f2f6fa;--no:#b3261e;--ok:#1b7a43}' +
    '.w.dark{--bg:#1f2731;--tx:#e6edf3;--tx2:#9aa9b8;--bd:#3a4654;--ac:#7fb0de;--acTx:#10202e;--sf:#2a3440;--no:#ff8a80;--ok:#7bd49b}' +
    '.fab{position:fixed;right:14px;bottom:' + bottom + 'px;z-index:2147483000;height:40px;padding:0 13px 0 11px;' +
      'display:flex;align-items:center;gap:6px;border-radius:20px;border:1px solid var(--bd);background:var(--bg);' +
      'color:var(--tx2);font-size:13px;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.14);opacity:.9}' +
    '.fab:hover,.fab:focus-visible{opacity:1;color:var(--ac);border-color:var(--ac);outline:none}' +
    '.fab svg{width:17px;height:17px;flex:none}' +
    '.panel{position:fixed;right:14px;bottom:' + (bottom + 50) + 'px;z-index:2147483001;width:min(370px,calc(100vw - 28px));' +
      'max-height:calc(100vh - ' + (bottom + 70) + 'px);overflow-y:auto;background:var(--bg);color:var(--tx);' +
      'border:1px solid var(--bd);border-radius:14px;padding:15px 15px 13px;box-shadow:0 14px 44px rgba(0,0,0,.28)}' +
    '.panel[hidden]{display:none}' +
    '.top{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}' +
    '.top b{font-size:15px}' +
    '.x{border:0;background:none;color:var(--tx2);font-size:20px;line-height:1;cursor:pointer;padding:4px 6px;border-radius:6px}' +
    '.x:hover{background:var(--sf)}' +
    '.kinds{display:flex;gap:6px;margin-bottom:9px;flex-wrap:wrap}' +
    '.kinds button{min-height:34px;padding:0 12px;border-radius:17px;border:1px solid var(--bd);background:var(--bg);' +
      'color:var(--tx2);font-size:13px;cursor:pointer}' +
    '.kinds button.on{background:var(--ac);border-color:var(--ac);color:var(--acTx);font-weight:600}' +
    'textarea,input{width:100%;border:1px solid var(--bd);border-radius:9px;background:var(--sf);color:var(--tx);' +
      'font-size:14.5px;padding:10px 11px;outline:none}' +
    'textarea{min-height:118px;resize:vertical;line-height:1.7}' +
    'textarea:focus,input:focus{border-color:var(--ac)}' +
    'input{margin-top:7px;height:40px}' +
    '.hint{font-size:11.5px;line-height:1.6;color:var(--tx2);margin:8px 1px 10px}' +
    '.row{display:flex;align-items:center;justify-content:space-between;gap:10px}' +
    '.cnt{font-size:11.5px;color:var(--tx2)}' +
    '.go{min-height:40px;padding:0 18px;border-radius:10px;border:0;background:var(--ac);color:var(--acTx);' +
      'font-size:14px;font-weight:600;cursor:pointer}' +
    '.go:disabled{opacity:.45;cursor:default}' +
    '.msg{font-size:13px;margin-top:9px;line-height:1.6}' +
    '.msg.err{color:var(--no)} .msg.ok{color:var(--ok)}' +
    '@media print{.fab,.panel{display:none!important}}' +
    '</style>' +
    '<div class="w">' +
      '<button class="fab" type="button" aria-label="의견 보내기" aria-haspopup="dialog">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M21 12a8 8 0 0 1-8 8H5l-2 2V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8z"/></svg>의견</button>' +
      '<div class="panel" role="dialog" aria-label="의견 보내기" hidden>' +
        '<div class="top"><b>의견 보내기</b><button class="x" type="button" aria-label="닫기">×</button></div>' +
        '<div class="kinds">' +
          '<button type="button" data-k="오류">오류 신고</button>' +
          '<button type="button" data-k="제안" class="on">개선 제안</button>' +
          '<button type="button" data-k="기타">기타</button></div>' +
        '<textarea maxlength="' + MAX + '" placeholder="불편했던 점, 틀린 내용, 있었으면 하는 기능을 적어 주세요."></textarea>' +
        '<input type="text" maxlength="120" placeholder="연락처 (선택) — 답을 받고 싶을 때만" autocomplete="off">' +
        '<div class="hint">관리자에게 바로 전달됩니다. 지금 보고 있는 화면 이름과 화면 크기가 함께 갑니다(답안·문제 내용은 가지 않습니다).</div>' +
        '<div class="row"><span class="cnt">0 / ' + MAX + '</span><button class="go" type="button" disabled>보내기</button></div>' +
        '<div class="msg" hidden></div>' +
      '</div>' +
    '</div>';

  var $ = function (s) { return root.querySelector(s); };
  var wrap = $('.w'), fab = $('.fab'), panel = $('.panel'), ta = $('textarea'), contact = $('input'),
      go = $('.go'), msg = $('.msg'), cnt = $('.cnt');
  var kind = '제안', busy = false;

  function say(text, cls) { msg.hidden = !text; msg.textContent = text || ''; msg.className = 'msg ' + (cls || ''); }
  function sync() {
    var n = ta.value.trim().length;
    cnt.textContent = ta.value.length + ' / ' + MAX;
    go.disabled = busy || n < 2;
    try { n ? localStorage.setItem(DRAFT_KEY, ta.value) : localStorage.removeItem(DRAFT_KEY); } catch (e) {}
  }
  function open() {
    wrap.className = 'w' + (isDark() ? ' dark' : '');
    panel.hidden = false; fab.setAttribute('aria-expanded', 'true');
    say('');
    // 쓰다 닫았거나 신호가 끊겨 못 보낸 글을 되살린다
    try { if (!ta.value) ta.value = localStorage.getItem(DRAFT_KEY) || ''; } catch (e) {}
    sync();
    setTimeout(function () { ta.focus(); }, 30);
  }
  function close() { panel.hidden = true; fab.setAttribute('aria-expanded', 'false'); }
  window.LawFeedback.open = open;

  fab.addEventListener('click', function () { panel.hidden ? open() : close(); });
  $('.x').addEventListener('click', close);
  ta.addEventListener('input', sync);
  $('.kinds').addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('button[data-k]');
    if (!b) return;
    kind = b.dataset.k;
    var all = root.querySelectorAll('.kinds button');
    for (var i = 0; i < all.length; i++) all[i].className = all[i] === b ? 'on' : '';
  });
  go.addEventListener('click', function () {
    if (busy) return;
    busy = true; sync(); go.textContent = '보내는 중…'; say('');
    send({ kind: kind, text: ta.value, contact: contact.value }).then(function () {
      ta.value = ''; contact.value = '';
      say('보냈습니다. 고맙습니다.', 'ok');
      setTimeout(function () { if (!ta.value) close(); }, 1700);
    }).catch(function (e) {
      // 글은 지우지 않는다 — 신호가 돌아오면 그대로 다시 보낼 수 있게
      say((e && e.message) || '보내지 못했습니다. 잠시 후 다시 눌러 주세요.', 'err');
    }).then(function () { busy = false; go.textContent = '보내기'; sync(); });
  });

  // 글자판 이벤트는 여기서 멈춘다(위 ⚠ 참고). Esc 만 직접 받아 닫는다.
  ['keydown', 'keyup', 'keypress'].forEach(function (t) {
    wrap.addEventListener(t, function (e) {
      if (t === 'keydown' && e.key === 'Escape' && !panel.hidden) { close(); fab.focus(); }
      e.stopPropagation();
    });
  });

  function mount() {
    wrap.className = 'w' + (isDark() ? ' dark' : '');
    document.body.appendChild(host);
  }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
})();
