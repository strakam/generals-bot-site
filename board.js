// Mountable game board. Renders a generals.io replay (or a procedural sim
// fallback) into a container element. Multiple boards can coexist on a page.
//
// Usage:
//   GeneralsBoard.mount({ container: el, replayUrls: [...], frameMs: 110 });
//
// If no replayUrls are passed, a sensible default set is used.
(function () {
  const DEFAULT_REPLAYS = [
    'assets/replay_06.json',
    'assets/replay_07.json',
    'assets/replay_08.json',
  ];

  // Per-frame cumulative castle sets from the ticks' "built" events (castles
  // appear mid-game under the build-castles ruleset). Frames without events
  // share the same Set instance, so this is cheap even for 1200-tick replays.
  function builtIndex(rep, COLS) {
    const per = [];
    let cur = new Set();
    for (let k = 0; k < rep.ticks.length; k++) {
      const b = rep.ticks[k].built;
      if (b && b.length) {
        cur = new Set(cur);
        for (const [r, c] of b) cur.add(r * COLS + c);
      }
      per.push(cur);
    }
    return per;
  }

  function mount(opts) {
    const container = opts && opts.container;
    if (!container) return null;

    const REPLAY_URLS = (opts.replayUrls && opts.replayUrls.length)
      ? opts.replayUrls.slice()
      : DEFAULT_REPLAYS.slice();
    const FRAME_MS = opts.frameMs || 110;

    let COLS = 28;
    let ROWS = 16;
    let tiles = [];
    let els = [];
    let playbackTimer = null;
    let currentReplayIdx = Math.floor(Math.random() * REPLAY_URLS.length);

    const idx = (x, y) => y * COLS + x;

    function sizeContainer() {
      container.style.setProperty('--cols', COLS);
      container.style.setProperty('--rows', ROWS);
    }

    function buildDom(n) {
      container.innerHTML = '';
      els = [];
      for (let i = 0; i < n; i++) {
        const el = document.createElement('div');
        el.className = 'tile';
        el.style.setProperty('--d', (Math.random() * 500).toFixed(0) + 'ms');
        el.style.opacity = '0';
        container.appendChild(el);
        els.push(el);
      }
      requestAnimationFrame(() => requestAnimationFrame(() => {
        for (const el of els) el.style.opacity = '';
      }));
    }

    function render() {
      for (let i = 0; i < tiles.length; i++) {
        const t = tiles[i];
        const el = els[i];
        let cls = 'tile';
        let content = '';
        // owner -2 = fog: neither player sees this cell. Army/ownership are
        // hidden, but mountains are static terrain and stay shown (grayer, with
        // the mountain icon) — like obstacles-in-fog in the original game.
        if (t.owner === -2) {
          cls += ' fog';
          if (t.mountain) { cls += ' fog-mountain has-mountain'; content = '<span class="icon"></span>'; }
        } else {
          if (t.mountain) cls += ' mountain has-mountain';
          else if (t.owner === 0) cls += ' blue';
          else if (t.owner === 1) cls += ' red';
          else if (t.castle && t.owner === -1) cls += ' neutral-castle';
          else cls += ' neutral';
          if (t.general) cls += ' has-general';
          else if (t.castle) cls += ' has-castle';

          if (t.general || t.castle) {
            content = '<span class="icon"></span>';
            if (t.count > 0) content += `<span class="num">${t.count}</span>`;
          } else if (t.mountain) {
            content = '<span class="icon"></span>';
          } else if (t.owner !== -1 && t.count > 0) {
            content = `<span class="num">${t.count}</span>`;
          }
        }
        if (el.className !== cls) el.className = cls;
        if (el.innerHTML !== content) el.innerHTML = content;
      }
    }

    function playReplay(replay) {
      ROWS = replay.dims.rows;
      COLS = replay.dims.cols;
      sizeContainer();

      const mountainSet = new Set(replay.mountains.map(([r, c]) => r * COLS + c));
      const castleMap = new Map((replay.castles || replay.cities).map((c) => [c.pos[0] * COLS + c.pos[1], true]));
      const generalSet = new Set(replay.generals.map(([r, c]) => r * COLS + c));
      const builtByFrame = builtIndex(replay, COLS);

      tiles = Array.from({ length: ROWS * COLS }, (_, i) => ({
        owner: -1,
        count: 0,
        mountain: mountainSet.has(i),
        baseCastle: castleMap.has(i),
        castle: castleMap.has(i),
        general: generalSet.has(i),
      }));

      buildDom(tiles.length);

      const totalFrames = replay.ticks.length;
      let frame = Math.floor(Math.random() * Math.max(1, Math.floor(totalFrames / 2)));

      function step() {
        const tick = replay.ticks[frame];
        const built = builtByFrame[frame];
        for (let r = 0; r < ROWS; r++) {
          const armyRow = tick.armies[r];
          const ownerRow = tick.owners[r];
          for (let c = 0; c < COLS; c++) {
            const i = r * COLS + c;
            const t = tiles[i];
            t.count = armyRow[c];
            t.owner = ownerRow[c];
            t.castle = t.baseCastle || built.has(i);
          }
        }
        render();
        frame += 1;
        if (frame >= totalFrames) {
          clearInterval(playbackTimer);
          container.classList.add('fading');
          setTimeout(() => {
            currentReplayIdx = (currentReplayIdx + 1) % REPLAY_URLS.length;
            loadAndPlay(REPLAY_URLS[currentReplayIdx]);
          }, 900);
        }
      }

      step();
      playbackTimer = setInterval(step, FRAME_MS);
    }

    function loadAndPlay(url) {
      fetch(url)
        .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
        .then((replay) => {
          container.classList.remove('fading');
          playReplay(replay);
        })
        .catch(() => playSimulation());
    }

    // Procedural fallback if no replay loads.
    function playSimulation() {
      sizeContainer();
      const TICK_MS = 220;
      const RESET_MS = 45000;
      let tickCount = 0;
      let resetTimer = null;

      const inBounds = (x, y) => x >= 0 && x < COLS && y >= 0 && y < ROWS;
      const neighbors = (x, y) => [[x+1,y],[x-1,y],[x,y+1],[x,y-1]].filter(([a,b]) => inBounds(a,b));

      function seed() {
        tiles = Array.from({ length: COLS * ROWS }, () => ({
          owner: -1, count: 0, mountain: false, general: false, castle: false,
        }));
        const mountainCount = Math.floor(COLS * ROWS * 0.14);
        for (let i = 0; i < mountainCount; i++) {
          const x = Math.floor(Math.random() * COLS);
          const y = Math.floor(Math.random() * ROWS);
          tiles[idx(x, y)].mountain = true;
        }
        const bx = 1 + Math.floor(Math.random() * 3);
        const by = ROWS - 2 - Math.floor(Math.random() * 3);
        const bg = tiles[idx(bx, by)];
        bg.mountain = false; bg.owner = 0; bg.general = true; bg.count = 1;
        const rx = COLS - 2 - Math.floor(Math.random() * 3);
        const ry = 1 + Math.floor(Math.random() * 3);
        const rg = tiles[idx(rx, ry)];
        rg.mountain = false; rg.owner = 1; rg.general = true; rg.count = 1;
        let placed = 0, attempts = 0;
        const castleCount = 5 + Math.floor(Math.random() * 3);
        while (placed < castleCount && attempts < 200) {
          attempts++;
          const x = Math.floor(Math.random() * COLS);
          const y = Math.floor(Math.random() * ROWS);
          const t = tiles[idx(x, y)];
          if (t.mountain || t.general || t.castle) continue;
          t.castle = true;
          t.count = 40 + Math.floor(Math.random() * 10);
          placed++;
        }
      }

      function tick() {
        tickCount++;
        for (const t of tiles) {
          if (t.owner === -1) continue;
          if (t.general) t.count += 1;
          else if (t.castle) { if (tickCount % 2 === 0) t.count += 1; }
          else if (tickCount % 22 === 0) t.count += 1;
        }
        const frontier = [];
        for (let y = 0; y < ROWS; y++) {
          for (let x = 0; x < COLS; x++) {
            const t = tiles[idx(x, y)];
            if (t.owner === -1 || t.count < 2) continue;
            const nbs = neighbors(x, y);
            if (nbs.some(([nx, ny]) => { const n = tiles[idx(nx, ny)]; return !n.mountain && n.owner !== t.owner; })) {
              frontier.push({ x, y });
            }
          }
        }
        for (let i = frontier.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [frontier[i], frontier[j]] = [frontier[j], frontier[i]];
        }
        const actCount = Math.min(frontier.length, 8 + Math.floor(tickCount / 40));
        for (let k = 0; k < actCount; k++) {
          const { x, y } = frontier[k];
          const src = tiles[idx(x, y)];
          if (src.owner === -1 || src.count < 2) continue;
          const nbs = neighbors(x, y).filter(([nx, ny]) => !tiles[idx(nx, ny)].mountain);
          if (!nbs.length) continue;
          const neutrals = nbs.filter(([nx, ny]) => tiles[idx(nx, ny)].owner === -1);
          const enemies = nbs.filter(([nx, ny]) => {
            const n = tiles[idx(nx, ny)];
            return n.owner !== -1 && n.owner !== src.owner;
          });
          let target;
          if (neutrals.length && (!enemies.length || Math.random() < 0.75)) {
            target = neutrals[Math.floor(Math.random() * neutrals.length)];
          } else if (enemies.length) {
            target = enemies[Math.floor(Math.random() * enemies.length)];
          } else continue;
          const [tx, ty] = target;
          const dst = tiles[idx(tx, ty)];
          const moving = src.count - 1;
          src.count = 1;
          if (dst.owner === -1) { dst.owner = src.owner; dst.count = moving; }
          else if (dst.owner === src.owner) dst.count += moving;
          else {
            if (moving > dst.count) {
              const wasGeneral = dst.general;
              dst.count = moving - dst.count;
              dst.owner = src.owner;
              if (wasGeneral) scheduleReset(1800);
            } else dst.count -= moving;
          }
        }
        render();
      }

      function scheduleReset(ms) {
        clearTimeout(resetTimer);
        resetTimer = setTimeout(() => {
          container.classList.add('fading');
          setTimeout(() => {
            seed();
            buildDom(tiles.length);
            render();
            container.classList.remove('fading');
            tickCount = 0;
          }, 800);
        }, ms);
      }

      seed();
      buildDom(tiles.length);
      render();
      setInterval(tick, TICK_MS);
      scheduleReset(RESET_MS);
    }

    loadAndPlay(REPLAY_URLS[currentReplayIdx]);
    return { container };
  }

  // Controlled single-replay player (for the replays page): play/pause/scrub/
  // speed, no auto-advance. Self-contained so the eye-candy `mount` path above
  // stays untouched. Reuses the global .tile styling.
  function mountPlayer(opts) {
    const container = opts && opts.container;
    if (!container) return null;
    let FRAME_MS = opts.frameMs || 160;
    const onFrame = typeof opts.onFrame === 'function' ? opts.onFrame : null;
    let ROWS = 0, COLS = 0, tiles = [], els = [], replay = null, frame = 0, total = 0, timer = null, builtByFrame = [];

    function render() {
      for (let i = 0; i < tiles.length; i++) {
        const t = tiles[i], el = els[i];
        let cls = 'tile';
        let content = '';
        if (t.owner === -2) {
          cls += ' fog';
          if (t.mountain) { cls += ' fog-mountain has-mountain'; content = '<span class="icon"></span>'; }
        } else {
          if (t.mountain) cls += ' mountain has-mountain';
          else if (t.owner === 0) cls += ' blue';
          else if (t.owner === 1) cls += ' red';
          else if (t.castle && t.owner === -1) cls += ' neutral-castle';
          else cls += ' neutral';
          if (t.general) cls += ' has-general';
          else if (t.castle) cls += ' has-castle';
          if (t.general || t.castle) {
            content = '<span class="icon"></span>';
            if (t.count > 0) content += `<span class="num">${t.count}</span>`;
          } else if (t.mountain) {
            content = '<span class="icon"></span>';
          } else if (t.owner !== -1 && t.count > 0) {
            content = `<span class="num">${t.count}</span>`;
          }
        }
        if (el.className !== cls) el.className = cls;
        if (el.innerHTML !== content) el.innerHTML = content;
      }
    }
    function setStatic(rep) {
      replay = rep;
      ROWS = rep.dims.rows; COLS = rep.dims.cols;
      container.style.setProperty('--cols', COLS);
      container.style.setProperty('--rows', ROWS);
      const mountainSet = new Set(rep.mountains.map(([r, c]) => r * COLS + c));
      const castleMap = new Map((rep.castles || rep.cities).map((c) => [c.pos[0] * COLS + c.pos[1], true]));
      const generalSet = new Set(rep.generals.map(([r, c]) => r * COLS + c));
      builtByFrame = builtIndex(rep, COLS);
      tiles = Array.from({ length: ROWS * COLS }, (_, i) => ({
        owner: -1, count: 0,
        mountain: mountainSet.has(i), baseCastle: castleMap.has(i), castle: castleMap.has(i), general: generalSet.has(i),
      }));
      container.innerHTML = '';
      els = tiles.map(() => { const el = document.createElement('div'); el.className = 'tile'; container.appendChild(el); return el; });
    }
    function paint() {
      if (!replay) return;
      const tick = replay.ticks[frame];
      const built = builtByFrame[frame];
      for (let r = 0; r < ROWS; r++) {
        const ar = tick.armies[r], orow = tick.owners[r];
        for (let c = 0; c < COLS; c++) {
          const i = r * COLS + c; const t = tiles[i];
          t.count = ar[c]; t.owner = orow[c];
          t.castle = t.baseCastle || (built && built.has(i));
        }
      }
      applyFog();
      render();
      if (onFrame) onFrame(frame, total);
    }
    // Union fog of war: a cell is visible iff it's within one tile (a 3x3
    // window) of a cell owned by either player — i.e. the two players' vision
    // unioned (dilate(P0)∪dilate(P1) = dilate(P0∪P1)). Everything else becomes
    // fog (owner -2). Computed from the owner grid, so god-view league replays
    // are fogged at render time without regenerating them; mountains stay shown
    // (render() draws fog-mountains). Stats() reads the raw tick, so the
    // scoreboard is unaffected.
    function applyFog() {
      const tick = replay.ticks[frame];
      const owned = new Uint8Array(ROWS * COLS);
      for (let r = 0; r < ROWS; r++) {
        const orow = tick.owners[r];
        for (let c = 0; c < COLS; c++) {
          const o = orow[c];
          if (o === 0 || o === 1) owned[r * COLS + c] = 1;
        }
      }
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          let vis = false;
          for (let dr = -1; dr <= 1 && !vis; dr++) {
            const rr = r + dr; if (rr < 0 || rr >= ROWS) continue;
            for (let dc = -1; dc <= 1; dc++) {
              const cc = c + dc; if (cc < 0 || cc >= COLS) continue;
              if (owned[rr * COLS + cc]) { vis = true; break; }
            }
          }
          if (!vis) tiles[r * COLS + c].owner = -2;
        }
      }
    }
    function pause() { if (timer) { clearInterval(timer); timer = null; } }
    function play() {
      if (timer || !replay) return;
      if (frame >= total - 1) frame = 0;
      timer = setInterval(() => { if (frame >= total - 1) { pause(); paint(); return; } frame += 1; paint(); }, FRAME_MS);
    }
    function seek(f) { frame = Math.max(0, Math.min(total - 1, f | 0)); paint(); }
    function setSpeed(ms) { FRAME_MS = ms; if (timer) { pause(); play(); } }
    // Per-player land (tiles owned) + army (sum of armies) at the current frame.
    function stats() {
      if (!replay) return null;
      const tick = replay.ticks[frame];
      const land = [0, 0], army = [0, 0];
      for (let r = 0; r < ROWS; r++) {
        const ar = tick.armies[r], orow = tick.owners[r];
        for (let c = 0; c < COLS; c++) {
          const o = orow[c];
          if (o === 0 || o === 1) { land[o]++; army[o] += ar[c]; }
        }
      }
      return { land, army };
    }
    async function load(url) {
      pause();
      const r = await fetch(url);
      if (!r.ok) throw new Error('replay fetch ' + r.status);
      // A replay is ~14 KB gzipped and ~1.2 MB raw, so the tournament's are
      // STORED gzipped rather than shipped raw. Blob serves them as
      // application/gzip with no Content-Encoding, so the browser hands us the
      // compressed bytes and we inflate here. Keyed on the URL, not on the
      // response type, so a plain .json (the league's replays, served through
      // the API proxy) still takes the untouched path.
      let rep;
      if (/\.gz(\?|$)/.test(url)) {
        // DecompressionStream landed in Safari 16.4 (iOS 16.4, Mar 2023). Older
        // iOS would otherwise hand the gzip bytes to JSON.parse and fail with a
        // syntax error the caller reports as "could not load this replay",
        // blaming the replay for the browser.
        if (typeof DecompressionStream === 'undefined') throw new Error('gzip-unsupported');
        rep = await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).json();
      } else {
        rep = await r.json();
      }
      setStatic(rep);
      frame = 0; total = rep.ticks.length;
      paint();
      return { total, players: rep.players, winner: rep.winner, seed: rep.seed };
    }
    return {
      load, play, pause, seek, setSpeed, stats,
      toggle() { timer ? pause() : play(); },
      get frame() { return frame; },
      get total() { return total; },
      get playing() { return !!timer; },
    };
  }

  window.GeneralsBoard = { mount, mountPlayer };

  // Backward compat: auto-mount on a single #board element if present.
  document.addEventListener('DOMContentLoaded', () => {
    const legacy = document.getElementById('board');
    if (legacy) mount({ container: legacy });
  });
})();
