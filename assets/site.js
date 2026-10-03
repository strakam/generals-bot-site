// Shared site components: <site-nav> and <site-footer>.
// Static archive build: no sign-in, no API — the nav is the same for everyone.
// Each page sets the current page via attribute: <site-nav current="about">.

const NAV_ITEMS = [
  { id: 'about', label: 'About', href: '/about' },
  { id: 'rules', label: 'Rules', href: '/rules' },
  { id: 'docs', label: 'Get started', href: '/docs' },
  { id: 'leaderboard', label: 'Leaderboard', href: '/leaderboard' },
  { id: 'replays', label: 'Replays', href: '/replays' },
  { id: 'results', label: 'Results', href: '/results' },
];

// ---- shared page helpers (window.GC) ---------------------------------------
// One canonical copy of the tiny helpers every page used to paste locally.
// site.js is a deferred classic script and the pages' inline scripts are
// modules, so GC is always defined before page code runs.
const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
const MEDALS = ['🥇', '🥈', '🥉'];
// ISO 3166-1 alpha-2 → flag emoji (regional indicator pair); '' if unset/bad
const countryFlag = (cc) => /^[A-Z]{2}$/.test(cc || '')
  ? String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
  : '';
const fmtDate = (d) => { try { return new Date(d).toLocaleDateString(); } catch { return ''; } };
const fmtDateTime = (d) => {
  try { return new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); }
  catch { return ''; }
};

// ---- competition phase ------------------------------------------------------
// Static archive: the competition is over, so the phase is always "live,
// started" and resolves synchronously — no auth round-trip exists any
// more. The helpers below are kept so page code written against them still runs.
const clockOffset = 0;

function phaseFromOffset(startIso, offset) {
  const startMs = startIso ? Date.parse(startIso) : null;
  const now = () => Date.now() + offset;
  return {
    startMs,
    startsAt: startMs != null && !Number.isNaN(startMs) ? new Date(startMs) : null,
    live: startMs == null || Number.isNaN(startMs) || now() >= startMs,
    msLeft: () => (startMs == null ? 0 : Math.max(0, startMs - now())),
  };
}

function makePhase(startIso, nowIso) {
  return phaseFromOffset(startIso, nowIso ? Date.parse(nowIso) - Date.now() : 0);
}

// Historical deadlines, kept for the pages that print them. Both are in the past.
const SPRINT_END_ISO = '2026-08-08T12:00:00Z'; // Sat 8 Aug 2026, 14:00 Prague (CEST)
const MARATHON_END_ISO = '2026-09-01T12:00:00Z'; // Tue 1 Sep 2026, 14:00 Prague (CEST)

const phaseFor = (iso) => phaseFromOffset(iso, clockOffset);

// Always live: the competition started on 2026-08-01 and has finished.
const phasePromise = Promise.resolve(phaseFromOffset(null, 0));

const pad2 = (n) => String(n).padStart(2, '0');
const fmtLeft = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  return `${d ? d + 'd ' : ''}${pad2(Math.floor((s % 86400) / 3600))}h ${pad2(Math.floor((s % 3600) / 60))}m ${pad2(s % 60)}s`;
};
// Rendered in the VIEWER'S locale + timezone (same instant for everyone).
// The explicit timezone suffix ("2:00 PM GMT+2") is what stops two people in
// different countries from thinking they're seeing different start times.
const fmtStartsAt = (phase) => {
  try {
    return phase.startsAt.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    });
  } catch (_) { return ''; }
};

// Tick a live countdown into `el`; at zero, reload — the server gates flip on
// the same clock, so the page comes back in its competition layout.
function tickCountdown(el, phase) {
  const t = setInterval(tick, 1000);
  function tick() {
    const left = phase.msLeft();
    el.textContent = fmtLeft(left);
    if (left <= 0) { clearInterval(t); setTimeout(() => location.reload(), 1500); }
  }
  tick();
}

// Shared locked-state panel for pages that are dark pre-release. Callers pass
// TRUSTED literal html for `noteHtml` (links to docs etc). Wire the clock after
// insertion: GC.tickCountdown(el.querySelector('[data-count]'), phase).
function lockedPanelHtml(phase, title, noteHtml) {
  return `
    <div class="gc-locked">
      <p class="gc-locked-title">${escapeHtml(title)}</p>
      <div class="gc-locked-count" data-count></div>
      <p class="gc-locked-when">Competition opens ${escapeHtml(fmtStartsAt(phase))}</p>
      ${noteHtml ? `<p class="gc-locked-note">${noteHtml}</p>` : ''}
    </div>`;
}

// Fuzzy name match, shared by the /replays list and the /player match list.
// Every character of the query must appear in the name IN ORDER but not
// necessarily adjacently, so "fldz" finds "fildrichz" and a half-remembered
// name still lands. Score rewards consecutive runs, hits at a word start, and a
// literal substring — so the obvious answer still ranks first. Returns null
// when the name doesn't match at all. `q` must already be lowercased.
const fuzzy = (name, q) => {
  const t = (name || '').toLowerCase();
  const idx = [];
  let pos = 0, score = 0, prev = -2;
  for (let k = 0; k < q.length; k++) {
    const i = t.indexOf(q[k], pos);
    if (i < 0) return null;
    idx.push(i);
    score += 10;
    if (i === prev + 1) score += 15;                         // consecutive run
    if (i === 0 || !/[a-z0-9]/.test(t[i - 1])) score += 20;  // start of a word
    prev = i; pos = i + 1;
  }
  if (t.includes(q)) score += 40;        // a real substring beats a scatter
  return { score: score - idx[0] * 2 - (t.length - q.length) * 0.5, idx };
};

// Bold the characters the query matched. Slices around the hits so every other
// part of the name is still escaped exactly once — names are user-controlled.
const hiMatch = (name, mt) => {
  if (!mt) return escapeHtml(name);
  let out = '', last = 0;
  for (const i of mt.idx) {
    out += escapeHtml(name.slice(last, i)) + `<b class="fz-hit">${escapeHtml(name.slice(i, i + 1))}</b>`;
    last = i + 1;
  }
  return out + escapeHtml(name.slice(last));
};

window.GC = {
  esc: escapeHtml, MEDALS, countryFlag, fmtDate, fmtDateTime,
  phase: () => phasePromise, makePhase, tickCountdown, fmtStartsAt, lockedPanelHtml,
  fuzzy, hiMatch,
  phaseFor, fmtLeft, SPRINT_END_ISO, MARATHON_END_ISO,
};
// -----------------------------------------------------------------------------

class SiteNav extends HTMLElement {
  connectedCallback() {
    const current = this.getAttribute('current') || '';
    this.innerHTML = `
      <nav class="site-nav" aria-label="Primary">
        <div class="site-nav-inner">
          <a class="site-nav-brand" href="/" aria-label="Home">
            <span class="site-nav-brand-strong">GENERALS</span><span class="site-nav-brand-dim">.COMPETITION</span>
          </a>
          <ul class="site-nav-list">
            ${NAV_ITEMS.map(
              (i) =>
                `<li><a href="${i.href}" data-nav="${i.id}" class="${current === i.id ? 'is-current' : ''}">${i.label}</a></li>`
            ).join('')}
          </ul>
        </div>
      </nav>
    `;
  }
}

class SiteFooter extends HTMLElement {
  connectedCallback() {
    const year = new Date().getFullYear();
    this.innerHTML = `
      <footer class="site-footer">
        <div class="site-footer-inner">
          <div class="site-footer-sponsors">
            <span class="site-footer-label">Presented by</span>
            <a href="https://equilibre.ai/" target="_blank" rel="noopener" class="site-footer-sponsor" aria-label="Equilibre Technologies"><img src="/equilibre-logo.png?v=2" alt="Equilibre Technologies" class="site-footer-logo"></a>
            <a href="https://ufal.mff.cuni.cz/" target="_blank" rel="noopener" class="site-footer-sponsor" aria-label="ÚFAL"><img src="/assets/logo_ufal.svg" alt="ÚFAL" class="site-footer-logo"></a>
            <a href="https://generals.io/" target="_blank" rel="noopener" class="site-footer-sponsor" aria-label="generals.io"><img src="/assets/generalsio-logo.png" alt="generals.io" class="site-footer-logo"></a>
          </div>
          <div class="site-footer-meta">
            <span>© ${year} Generals Competition</span>
            <a href="https://discord.gg/AykvgRVPj" target="_blank" rel="noopener">Discord</a>
            <a href="https://github.com/strakam/generals-bots" target="_blank" rel="noopener">GitHub</a>
          </div>
        </div>
      </footer>
    `;
  }
}

customElements.define('site-nav', SiteNav);
customElements.define('site-footer', SiteFooter);
