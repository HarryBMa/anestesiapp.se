/* ============================================================
   Narkos Dagblad — Portrait TV  v4.6
   DevTools Snippet for TESSA Dagblad (tessa.sematic.se)
   Read-only overlay: never writes, clicks or submits in TESSA.
   Designed for a 1080×1920 portrait screen, scales to any size.
   ============================================================ */
(() => {
  /* ---------- settings ---------- */
  const KIOSK = true;          /* true = no buttons, hidden cursor. false = debug toggle visible */
  const SHORT_NAMES = true;    /* "Anna Karin Svensson" -> "Anna KS" */
  const HIDE_ABSENT_REASON = true; /* never show comments/reasons for absent staff */
  const AUTO_TODAY = true;     /* keep the board on the right day by itself */
  const NEXT_DAY_AT = '00:00'; /* when to switch to tomorrow's Dagblad, e.g. '21:30' to show it in the evening */
  const FOLLOW_DAY = true;     /* dim finished shifts, show shift progress, Kväll first once it starts */
  const NIGHT = ['21:30', '06:00']; /* dark, dim theme between these times (screen glare + burn-in) */
  const SHOW_DEFICIT = false;  /* TESSA's own warning counter in the header */

  /* ---------- re-run safety ---------- */
  if (window.__nk) { try { window.__nk.stop(); } catch (e) {} }
  const state = { timers: [], obs: null, lastChange: null, lostAt: null, want: null, tries: 0, sig: null, changed: new Map() };

  /* ---------- helpers ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const txt = (r, s) => ($(s, r)?.innerText || '').trim();
  const val = (r, s) => { const e = $(s, r); return ((e && (e.value ?? e.innerText)) || '').trim(); };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const DOTS = /🟡|🔵|🟣|🟢|🔴|🟠|🟤|⚫|⚪/gu;
  const todayDtm = () => Math.floor((Date.now() - new Date().getTimezoneOffset() * 60000) / 864e5);

  function shortName(full) {
    const p = full.split(/\s+/).filter(Boolean);
    if (!SHORT_NAMES || p.length < 2) return full;
    return p[0] + ' ' + p.slice(1).map(w => w[0].toUpperCase()).join('');
  }

  function phones(label) {
    const grab = re => { const m = label.match(re); return m ? m[1].split(/[,\s]+/).filter(Boolean) : []; };
    return {
      op: grab(/Op\.?\s*tel(?:\s*nr)?:?\s*([\d,\s]+)/i),
      ane: grab(/Ane\.?\s*tel(?:\s*nr)?:?\s*([\d,\s]+)/i),
    };
  }

  /* ---------- TESSA session state (read-only) ---------- */
  function conn() {
    try {
      const M = window.Meteor;
      if (!M) return { ok: true, logged: true };
      const s = typeof M.status === 'function' ? M.status() : null;
      const logged = typeof M.userId === 'function' ? !!M.userId() : true;
      return { ok: !s || !!s.connected, logged };
    } catch (e) { return { ok: true, logged: true }; }
  }

  /* ---------- parse TESSA DOM ---------- */
  function parse() {
    const root = $('#otb');
    if (!root) return null;
    const header = txt(document, '.otb-main-name-header'); /* "Dag: Fredag 9 Oktober 2026, Vecka 41" */
    const hm = header.match(/:\s*(\S+)\s+(\d+)\s+(\S+)\s+(\d{4}),\s*Vecka\s*(\d+)/i);
    const data = {
      day: hm ? hm[1] : '', date: hm ? `${hm[2]} ${hm[3].toLowerCase()}` : header,
      week: hm ? hm[5] : '', deficit: txt(document, '.otb-time-deficit'),
      leads: [], rooms: [], pools: [], absent: [], headerCount: $$('.otb-station-header').length,
    };

    $$('.otb-table-container').forEach(c => {
      if (c.classList.contains('otb-table-container-hidden')) return;
      const main = txt(c, '.otb-main-name-header');
      if (/^Reflektion/i.test(main)) return;              /* skip Reflektion */
      const kvall = /^Kväll/i.test(main);

      $$('.otb-station-header', c).forEach(h => {
        const label = txt(h, '.station-name');
        const table = h.nextElementSibling?.classList.contains('otb-table') ? h.nextElementSibling : null;
        const bulletin = [txt(h, '.otb-header-message-text'), txt(h, '.station-day-bulletin')].filter(Boolean).join(' · ');
        const rows = table ? $$('.otb-entry', table).map(r => {
          const raw = txt(r, '.otb-user-description');
          const fiktiv = /-\s*Fiktiv/i.test(raw);
          const name = raw.replace(DOTS, '').replace(/\s*-\s*Fiktiv/i, '').trim();
          const roles = [];
          if (raw.includes('🟡')) roles.push('ANE');
          if (raw.includes('🔵')) roles.push('OP');
          if (raw.includes('🟣')) roles.push('STÖD');
          const group = txt(r, '.otb-td-employment-group');
          if (!roles.length) roles.push(/usk/i.test(group) ? 'USK' : /tand/i.test(group) ? 'TSK' : group.toUpperCase() || '—');
          const station = txt(r, '.otb-td-station').replace(/^[▰▱■□\s]+/, '');
          const time = txt(r, '.otb-td-time');
          const att = r.querySelector('.otb-attendence')?.className || '';
          const absent = r.classList.contains('otb-removed-output') || /Frånvaro/i.test(txt(r, '.odb-hitch-text-container'));
          return {
            name, short: fiktiv ? name : shortName(name), fiktiv, roles, group, station, time,
            note: val(r, '.shift-note-ta'), comment: val(r, '.comment-cell-ta'),
            online: /\bpp\b/.test(att), absent,
          };
        }) : [];

        const present = rows.filter(r => !r.absent);
        rows.filter(r => r.absent).forEach(r => data.absent.push({ ...r, where: label.replace(/\s*\(.*$/, '') }));

        if (/^Frånvaro/i.test(label)) { present.forEach(r => data.absent.push({ ...r, where: '' })); return; }
        if (/^Vårdledare/i.test(label)) {
          const ph = phones(label);
          present.forEach(r => {
            const side = /ane/i.test(r.station) || r.roles.includes('ANE') && !/op/i.test(r.station) ? 'ane' : 'op';
            data.leads.push({ ...r, side, tel: (ph[side] || [])[0] || (r.station.match(/(\d{5})/) || [])[1] || '' });
          });
          data.leadPhones = ph;
          return;
        }
        const roomM = label.match(/^Sal\s*(\d+)/i);
        if (roomM || /^Robot/i.test(label)) {
          const ph = phones(label);
          const op = [], ane = [];
          present.forEach(r => {
            const isAne = /\bAne$/i.test(r.station) || (!/\bOp$/i.test(r.station) && r.roles[0] === 'ANE');
            (isAne ? ane : op).push(r);
          });
          data.rooms.push({ id: roomM ? roomM[1] : 'Robot', robot: !roomM, kvall, ph, op, ane, bulletin, empty: !present.length });
          return;
        }
        data.pools.push({ name: label, kvall, rows: present, bulletin });
      });
    });

    return data;
  }

  /* ---------- render ---------- */
  const badgeCls = { ANE: 'b-ane', OP: 'b-op', USK: 'b-usk', TSK: 'b-tsk', 'STÖD': 'b-stod' };

  /* Small line icons (one stroke family) instead of emoji, so they render the same on every PC. */
  const svg = (d, cls) => `<svg class="nk-ic ${cls || ''}" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
  const IC = {
    phone: 'M6.6 3.5h2.6l1.4 4.3-2 1.6a12 12 0 0 0 6 6l1.6-2 4.3 1.4v2.6a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.6 5.7a2 2 0 0 1 2-2.2z',
    alert: 'M12 3.5 2.5 20h19L12 3.5zM12 10v4.5M12 17.3v.2',
  };

  const mins = t => { const m = /^(\d{1,2}):(\d{2})$/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : null; };
  const nowMins = d => d.getHours() * 60 + d.getMinutes();
  const hm = t => t ? t.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }) : '';
  function span(time) {
    const [a, b] = (time || '').split(/[-–]/).map(x => mins(x.trim()));
    if (a == null || b == null) return null;
    return { s: a, e: b > a ? b : b + 1440 }; /* a night shift ends tomorrow */
  }
  const isNight = d => { const n = nowMins(d), [a, b] = NIGHT.map(mins); return a > b ? (n >= a || n < b) : (n >= a && n < b); };
  const gone = (r, n) => { const sp = n >= 0 && span(r.time); return !!sp && n >= sp.e; };

  /* Lunch codes. Write "L" + the room's last digits in TESSA's note or comment: L1 = 3701,
     L3 = 3703, L4 = 3704, L11 = 3711, LR = Robot (L3701 also works), optionally with a time:
     "L1 11.30". The code becomes a "Lunch 3701" tag on the person and a "Lunch:" line on the
     room. A code that matches no room, or more than one, is left as written. */
  const LUNCH = /\bL\s?(R|\d{1,4})\b(?:\s*(\d{1,2})[:.](\d{2}))?/gi;
  function lunches(d) {
    d.rooms.forEach(r => { r.lunch = []; });
    const find = code => {
      code = code.toUpperCase();
      const day = d.rooms.filter(r => !r.kvall);
      const hits = code === 'R' ? day.filter(r => r.robot)
        : code.length >= 3 ? day.filter(r => !r.robot && r.id.endsWith(code))
        : day.filter(r => !r.robot && String(parseInt(r.id.slice(-2), 10)) === String(parseInt(code, 10)));
      return hits.length === 1 ? hits[0] : null;
    };
    const scan = p => {
      p.lunch = [];
      const take = text => (text || '').replace(LUNCH, (all, code, h, m) => {
        const room = find(code);
        if (!room) return all;
        const time = h ? `${h.padStart(2, '0')}:${m}` : '';
        p.lunch.push({ id: room.id, time });
        room.lunch.push({ short: p.short, time });
        return '';
      }).replace(/\s{2,}/g, ' ').replace(/^[\s,.;·-]+|[\s,.;·-]+$/g, '');
      p.note = take(p.note); p.comment = take(p.comment);
    };
    d.leads.forEach(scan);
    d.rooms.forEach(r => [...r.op, ...r.ane].forEach(scan));
    d.pools.forEach(pl => pl.rows.forEach(scan));
  }

  /* Delight, kept still: when TESSA changes someone's room, time, note or comment, that row gets a
     soft wash that fades out over ten minutes. Nothing moves, so the board never jumps; it just
     shows the corridor what is new since they last looked. The first paint is the baseline. */
  const FRESH_MS = 10 * 60000;
  function freshness(d) {
    const now = Date.now();
    const seen = new Map();
    const note = (r, where) => seen.set(r.name, [where, r.time, r.note, r.comment].join('|'));
    d.leads.forEach(r => note(r, 'VL ' + r.side));
    d.rooms.forEach(room => [...room.op, ...room.ane].forEach(r => note(r, room.id + (room.kvall ? 'k' : ''))));
    d.pools.forEach(p => p.rows.forEach(r => note(r, p.name)));
    if (state.sig) {
      seen.forEach((sig, name) => { if (state.sig.get(name) !== sig) state.changed.set(name, now); });
    }
    state.sig = seen;
    state.changed.forEach((t, name) => { if (now - t > FRESH_MS) state.changed.delete(name); });
  }
  const freshStyle = name => {
    const t = state.changed.get(name);
    if (!t) return '';
    const a = Math.max(0, 1 - (Date.now() - t) / FRESH_MS);
    return ` fresh" style="--fresh:${a.toFixed(2)}`;
  };

  /* Rooms are wide enough for the time beside the name; in the narrower pools it goes underneath. */
  function person(r, colRole, n, wide = true) {
    const extra = r.roles.filter(x => x !== colRole);
    const badges = extra.map(x => `<span class="nk-b ${badgeCls[x] || 'b-other'}">${esc(x)}</span>`).join('');
    const time = r.time ? `<span class="nk-time">${esc(r.time.replace(/-/, '–'))}</span>` : '';
    const left = gone(r, n);
    const tags = [left ? '<span class="nk-gone">Gått hem</span>' : '',
      ...(r.lunch || []).map(l => `<span class="nk-lun">Lunch ${esc(l.id)}${l.time ? ` ${l.time}` : ''}</span>`)].join('');
    const text = [r.note, r.comment].filter(Boolean).map(esc).join(' · ');
    const sub = [tags, wide ? '' : time, text].filter(Boolean).join(' ');
    return `<div class="nk-p${r.fiktiv ? ' fik' : ''}${left ? ' left' : ''}${freshStyle(r.name)}">
      <div class="nk-pl"><i class="nk-dot${r.online ? ' on' : ''}"></i><span class="nk-n">${esc(r.short)}</span>${badges}${wide ? time : ''}</div>
      ${sub ? `<div class="nk-sub">${sub}</div>` : ''}</div>`;
  }

  function message(title, body) {
    document.getElementById('nk').innerHTML = `<div class="nk-msg"><div>${svg(IC.alert, 'big')}<h1>${title}</h1><p>${body}</p></div></div>`;
  }

  function render(d) {
    const el = document.getElementById('nk');
    const c = conn();
    if (!c.logged) return message('TESSA är utloggad', 'Logga in på enhetskontot och klicka på bokmärket 📺&nbsp;TV-läge igen.');
    if (!d) return message('Väntar på TESSA…', 'Öppna Dagblad i TESSA.');
    if (!d.headerCount) return message('Kunde inte läsa Dagbladet', 'TESSA kan ha ändrat sidan. Säg till den som satte upp tavlan.');

    const now = new Date();
    const shown = headerDtm();
    const dayTag = shown == null ? '' : shown === targetDtm()
      ? (shown === todayDtm() + 1 ? ' <span class="nk-tag">I morgon</span>' : '')
      : ' <span class="nk-tag warn">Fel dag</span>';
    if (!c.ok && !state.lostAt) state.lostAt = now;
    if (c.ok) state.lostAt = null;
    /* Meteor reconnects on its own after short blips, so only warn after a minute without contact. */
    const lost = !!state.lostAt && now - state.lostAt > 60000;
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
    lunches(d);
    freshness(d);
    const night = isNight(now);
    el.classList.toggle('night', night);
    /* At night the day is over; showing everyone as "gone home" helps nobody, so the board rests. */
    const follow = FOLLOW_DAY && !night;
    const n = follow ? nowMins(now) : -1;
    d.rooms.forEach(r => {
      const sp = [...r.op, ...r.ane].map(x => span(x.time)).filter(Boolean);
      r.s = sp.length ? Math.min(...sp.map(x => x.s)) : null;
      r.e = sp.length ? Math.max(...sp.map(x => x.e)) : null;
      r.done = follow && r.e != null && n >= r.e;
      r.started = !follow || r.s == null || n >= r.s;
    });
    /* Rooms come in two labelled groups, Dag and Kväll, so a reorder reads as "Kväll moved up",
       not as rooms shuffling. Kväll goes first once it has started; finished day rooms sink to
       the bottom of Dag. */
    const kv = d.rooms.filter(r => r.kvall);
    const dayRooms = d.rooms.filter(r => !r.kvall);
    const dag = follow ? [...dayRooms.filter(r => !r.done), ...dayRooms.filter(r => r.done)] : dayRooms;
    const kvFirst = follow && kv.some(r => r.started);
    const groups = !kv.length ? [['', dag]] : kvFirst ? [['Kväll', kv], ['Dag', dag]] : [['Dag', dag], ['Kväll', kv]];
    const order = groups.map(([g, rs]) => g + ':' + rs.map(r => r.id + (r.done ? '.' : '')).join(',')).join('|');
    const reordered = state.order != null && state.order !== order;
    state.order = order;

    const lead = side => {
      const label = `<span class="nk-lt">VL ${side === 'ane' ? 'Ane' : 'Op'}</span>`;
      const tel = t => t ? `<span class="nk-tel">${svg(IC.phone)}${esc(t)}</span>` : '';
      const rows = d.leads.filter(l => l.side === side);
      if (!rows.length) return `<div class="nk-lead ${side}">${label}<span class="nk-ln">—</span>${tel((d.leadPhones?.[side] || [])[0])}</div>`;
      return rows.map(l => `<div class="nk-lead ${side}${freshStyle(l.name)}">${label}<span class="nk-ln">${esc(l.short)}</span>${tel(l.tel)}</div>`).join('');
    };

    const phones = (label, list) => list.length ? `<div class="nk-rph"><b>${label}</b><span>${list.map(n => `<span>${esc(n)}</span>`).join('')}</span></div>` : '';
    const room = r => {
      const pn = r.done ? -1 : n; /* a finished room is dimmed once, not each person again */
      const p = follow && r.started && !r.done && r.e > r.s ? Math.min(1, Math.max(0, (n - r.s) / (r.e - r.s))) : null;
      const lunch = r.lunch.length ? `<div class="nk-lunch"><b>Lunch</b> ${r.lunch.map(l => `${esc(l.short)}${l.time ? ` ${l.time}` : ''}`).join(' · ')}</div>` : '';
      return `
      <section class="nk-room${r.robot ? ' robot' : ''}${r.empty ? ' empty' : ''}${r.done ? ' done' : ''}">
        <div class="nk-rid">
          <div class="nk-num">${esc(r.id)}</div>
          ${phones('Op', r.ph.op)}${phones('Ane', r.ph.ane)}
        </div>
        <div class="nk-col op"><div class="nk-ch">Op</div>${r.op.map(x => person(x, 'OP', pn)).join('') || '<div class="nk-none">–</div>'}</div>
        <div class="nk-col ane"><div class="nk-ch">Ane</div>${r.ane.map(x => person(x, 'ANE', pn)).join('') || '<div class="nk-none">–</div>'}</div>
        ${lunch}
        ${r.bulletin ? `<div class="nk-bull">${esc(r.bulletin)}</div>` : ''}
        ${p != null ? `<div class="nk-prog" style="--p:${p.toFixed(3)}"></div>` : ''}
      </section>`;
    };

    const pool = p => `
      <section class="nk-pool${p.rows.length ? '' : ' empty'}">
        <h3>${esc(p.name)}${p.kvall ? ' <span class="nk-tag">Kväll</span>' : ''}</h3>
        ${p.bulletin ? `<div class="nk-bull">${esc(p.bulletin)}</div>` : ''}
        ${p.rows.map(x => person(x, null, n, false)).join('') || '<div class="nk-none">–</div>'}
      </section>`;

    const absent = d.absent.length ? `
      <footer class="nk-abs"><span class="nk-at">Frånvaro</span>
        <span class="nk-al">${d.absent.map(a => `${esc(a.short)}${!HIDE_ABSENT_REASON && a.comment ? ` (${esc(a.comment)})` : ''}`).join(' · ')}</span>
      </footer>` : '';

    el.innerHTML = `
      <div class="nk-page">
        ${!lost ? '' : `<div class="nk-stale">${svg(IC.alert)}Ingen kontakt med TESSA sedan ${hm(state.lostAt)}</div>`}
        <header class="nk-top">
          <div class="nk-date"><div class="nk-day">${esc(d.day)}${dayTag}</div><div class="nk-dm">${esc(d.date)} · v.${esc(d.week)}</div></div>
          <div class="nk-right">
            ${SHOW_DEFICIT && d.deficit ? `<div class="nk-def">${svg(IC.alert)}${esc(d.deficit.replace(/⚠️|⚠/g, '').trim())}</div>` : ''}
            <div class="nk-clock">${hm(now)}</div>
          </div>
        </header>
        <div class="nk-leads">${lead('ane')}${lead('op')}</div>
        <main class="nk-rooms${reordered && !calm ? ' swap' : ''}">${groups.map(([g, rs]) => (g ? `<h2 class="nk-group">${g}</h2>` : '') + rs.map(room).join('')).join('')}</main>
        <div class="nk-pools">${d.pools.map(pool).join('')}</div>
        ${absent}
      </div>`;
    fit();
    shift();
  }

  /* A static picture on a TV for weeks can burn in, so every ten minutes the content moves 2 px
     around a small square. It moves inside the page's own padding, so nothing grows and no
     scrollbar can appear; the page is never bigger than the screen. */
  function shift() {
    const [x, y] = [[0, 0], [2, 0], [2, 2], [0, 2]][Math.floor(Date.now() / 600000) % 4];
    const el = document.getElementById('nk');
    el.style.setProperty('--sx', x + 'px');
    el.style.setProperty('--sy', y + 'px');
  }

  /* Scale to the screen, then shrink only as far as stays readable from the corridor.
     Past that floor, pools go to three columns before text gets any smaller. */
  function fit() {
    const el = document.getElementById('nk');
    const page = el.querySelector('.nk-page');
    if (!page) return;
    const base = Math.min(innerWidth / 1080, innerHeight / 1920);
    const set = u => el.style.setProperty('--u', u + 'px');
    const squeeze = floor => {
      let u = parseFloat(el.style.getPropertyValue('--u')) || base;
      for (let i = 0; i < 4 && page.scrollHeight > innerHeight && u > floor; i++) {
        u = Math.max(floor, u * (innerHeight / page.scrollHeight) * 0.99); set(u);
      }
    };
    el.classList.remove('compact'); set(base);
    squeeze(base * 0.85);
    if (page.scrollHeight > innerHeight) { el.classList.add('compact'); squeeze(base * 0.85); }
    if (page.scrollHeight > innerHeight) squeeze(base * 0.6); /* an extreme day: smaller beats cut off */
  }

  /* ---------- styles: Catppuccin Latte, two role colours plus neutrals ---------- */
  const css = `
  #nk{--base:#eff1f5;--mantle:#e6e9ef;--crust:#dce0e8;--s1:#bcc0cc;--text:#4c4f69;--sub:#5c5f77;
    --op:#2a731c;--ane:#1650d4;--usk:#0d6e73;--tsk:#2e7a1f;--stod:#6b21c8;--badge-ink:#fff;--warn:#a8420a;--red:#b0102f;--live:#40a02b;--card:#fff;--track:#dce0e8;--sx:0px;--sy:0px;
    --u:1px;position:fixed;inset:0;z-index:2147483646;background:var(--base);color:var(--text);overflow:hidden;
    font-family:"Segoe UI Variable Text","Segoe UI",system-ui,-apple-system,sans-serif;font-variant-numeric:tabular-nums;
    font-size:calc(var(--u)*26);line-height:1.25;-webkit-font-smoothing:antialiased;${KIOSK ? 'cursor:none;' : ''}}
  #nk *{box-sizing:border-box;margin:0}
  #nk ::selection{background:#1650d433}
  #nk .nk-ic{width:1em;height:1em;flex:none;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;vertical-align:-.12em}
  #nk .nk-page{padding:calc(var(--u)*36 + var(--sy)) calc(var(--u)*36 - var(--sx)) calc(var(--u)*28 - var(--sy)) calc(var(--u)*36 + var(--sx));display:flex;flex-direction:column;gap:calc(var(--u)*16)}
  #nk .nk-stale{display:flex;align-items:center;gap:.5em;background:var(--warn);color:#fff;font-size:calc(var(--u)*28);font-weight:700;border-radius:calc(var(--u)*16);padding:calc(var(--u)*14) calc(var(--u)*20)}
  #nk .nk-top{display:flex;justify-content:space-between;align-items:flex-end;padding-bottom:calc(var(--u)*8)}
  #nk .nk-day{font-size:calc(var(--u)*72);font-weight:800;letter-spacing:-.02em;line-height:1}
  #nk .nk-dm{font-size:calc(var(--u)*32);color:var(--sub);margin-top:calc(var(--u)*6)}
  #nk .nk-tag{display:inline-block;font-size:calc(var(--u)*18);font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--text);background:var(--crust);border-radius:999px;padding:.15em .6em;vertical-align:middle}
  #nk .nk-tag.warn{background:var(--warn);color:#fff}
  #nk .nk-day .nk-tag{font-size:calc(var(--u)*24)}
  #nk .nk-right{display:flex;align-items:center;gap:calc(var(--u)*24)}
  #nk .nk-clock{font-size:calc(var(--u)*100);font-weight:300;line-height:.9;letter-spacing:-.03em}
  #nk .nk-def{display:flex;align-items:center;gap:.3em;font-size:calc(var(--u)*30);font-weight:700;color:var(--warn)}
  #nk .nk-leads{display:grid;grid-template-columns:1fr 1fr;gap:calc(var(--u)*14)}
  #nk .nk-lead{display:flex;align-items:baseline;gap:calc(var(--u)*12);background:var(--mantle);border-radius:calc(var(--u)*18);padding:calc(var(--u)*16) calc(var(--u)*22)}
  #nk .nk-lt{font-size:calc(var(--u)*20);font-weight:800;text-transform:uppercase;letter-spacing:.06em;white-space:nowrap}
  #nk .ane .nk-lt{color:var(--ane)} #nk .op .nk-lt{color:var(--op)}
  #nk .nk-ln{font-size:calc(var(--u)*34);font-weight:700;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #nk .nk-tel{display:flex;align-items:center;gap:.25em;font-size:calc(var(--u)*36);font-weight:800}
  #nk .nk-tel .nk-ic{width:.8em;height:.8em}
  #nk .nk-rooms{display:flex;flex-direction:column;gap:calc(var(--u)*12)}
  #nk .nk-room{position:relative;display:grid;grid-template-columns:calc(var(--u)*220) 1.15fr 1fr;background:var(--card);border-radius:calc(var(--u)*22);overflow:hidden}
  #nk .nk-room.done{opacity:.7}
  #nk .nk-group{font-size:calc(var(--u)*22);font-weight:800;text-transform:uppercase;letter-spacing:.12em;color:var(--sub);margin:calc(var(--u)*6) 0 calc(var(--u)*-4) calc(var(--u)*4)}
  #nk .nk-group:first-child{margin-top:0}
  #nk .nk-rooms.swap{animation:nk-swap .8s ease-out}
  @keyframes nk-swap{from{opacity:0}to{opacity:1}}
  #nk .nk-prog{position:absolute;left:calc(var(--u)*220);right:0;bottom:0;height:calc(var(--u)*5);background:var(--track)}
  #nk .nk-prog::after{content:"";position:absolute;inset:0;transform-origin:left;transform:scaleX(var(--p));background:var(--s1)}
  #nk .nk-lunch,#nk .nk-bull{grid-column:1/-1;border-top:calc(var(--u)*2) solid var(--crust);font-size:calc(var(--u)*23);padding:calc(var(--u)*10) calc(var(--u)*20)}
  #nk .nk-lunch b{font-weight:800;text-transform:uppercase;letter-spacing:.06em;font-size:.8em;color:var(--sub);margin-right:.4em}
  #nk .nk-room.empty{opacity:.5}
  #nk .nk-rid{background:var(--mantle);padding:calc(var(--u)*16) calc(var(--u)*20);display:flex;flex-direction:column;justify-content:center;gap:calc(var(--u)*5)}
  #nk .nk-num{font-size:calc(var(--u)*64);font-weight:800;letter-spacing:-.03em;line-height:1}
  #nk .robot .nk-num{font-size:calc(var(--u)*46)}
  #nk .nk-rph{display:flex;align-items:baseline;gap:.4em;font-size:calc(var(--u)*23);font-weight:600}
  #nk .nk-rph b{min-width:2.4em;font-weight:800;font-size:.72em;text-transform:uppercase;letter-spacing:.06em;color:var(--sub)}
  #nk .nk-rph>span{display:flex;flex-wrap:wrap;column-gap:.5em}
  #nk .nk-col{padding:calc(var(--u)*14) calc(var(--u)*20);display:flex;flex-direction:column;gap:calc(var(--u)*8)}
  #nk .nk-col.ane{border-left:calc(var(--u)*2) solid var(--crust)}
  #nk .nk-ch{font-size:calc(var(--u)*19);font-weight:800;text-transform:uppercase;letter-spacing:.1em}
  #nk .op .nk-ch{color:var(--op)} #nk .ane .nk-ch{color:var(--ane)}
  #nk .nk-p{display:flex;flex-direction:column;border-radius:calc(var(--u)*10);margin:0 calc(var(--u)*-8);padding:0 calc(var(--u)*8)}
  #nk .fresh{background:rgb(114 135 253 / calc(var(--fresh) * .22))}
  #nk.night .fresh{background:rgb(180 190 254 / calc(var(--fresh) * .18))}
  #nk .nk-pl{display:flex;align-items:center;gap:calc(var(--u)*10);min-width:0}
  #nk .nk-n{font-size:calc(var(--u)*32);font-weight:600;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #nk .fik .nk-n{font-style:italic;color:var(--sub);font-weight:500}
  #nk .nk-dot{flex:none;width:calc(var(--u)*13);height:calc(var(--u)*13);border-radius:50%;background:var(--s1)}
  #nk .nk-dot.on{background:var(--live)}
  #nk .nk-b{flex:none;font-size:calc(var(--u)*17);font-weight:800;letter-spacing:.04em;border-radius:calc(var(--u)*7);padding:.12em .42em;color:var(--badge-ink)}
  #nk .b-ane{background:var(--ane)} #nk .b-op{background:var(--op)} #nk .b-usk{background:var(--usk)} #nk .b-tsk{background:var(--tsk)} #nk .b-stod{background:var(--stod)} #nk .b-other{background:var(--crust);color:var(--text)}
  #nk .nk-p.left{opacity:.7}
  #nk .nk-gone,#nk .nk-lun{display:inline-block;font-size:.8em;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--sub);margin-right:.5em}
  #nk .nk-lun{color:var(--text);background:var(--crust);border-radius:calc(var(--u)*6);padding:0 .4em}
  #nk .nk-time{flex:none;margin-left:auto;padding-left:calc(var(--u)*10);font-size:calc(var(--u)*24);font-weight:500;color:var(--sub)}
  #nk .nk-sub .nk-time{margin:0 calc(var(--u)*6) 0 0;padding:0;font-size:1em}
  #nk .nk-sub{padding-left:calc(var(--u)*23);font-size:calc(var(--u)*23);line-height:1.3;color:var(--text)}
  #nk .nk-none{font-size:calc(var(--u)*26);color:var(--s1)}
  #nk .nk-bull{font-weight:600}
  #nk .nk-pools{display:grid;grid-template-columns:1fr 1fr;gap:calc(var(--u)*12)}
  #nk.compact .nk-pools{grid-template-columns:1fr 1fr 1fr}
  #nk .nk-pool{background:var(--mantle);border-radius:calc(var(--u)*20);padding:calc(var(--u)*16) calc(var(--u)*20);display:flex;flex-direction:column;gap:calc(var(--u)*8)}
  #nk .nk-pool.empty{opacity:.6}
  #nk .nk-pool h3{font-size:calc(var(--u)*19);font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--sub)}
  #nk .nk-pool .nk-n{font-size:calc(var(--u)*28)}
  #nk .nk-abs{display:flex;align-items:baseline;gap:calc(var(--u)*16);padding:calc(var(--u)*6) calc(var(--u)*4)}
  #nk .nk-at{flex:none;font-size:calc(var(--u)*19);font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--red)}
  #nk .nk-al{font-size:calc(var(--u)*25);color:var(--sub)}
  #nk .nk-msg{position:absolute;inset:0;display:grid;place-content:center;text-align:center;padding:10%;color:var(--sub)}
  #nk .nk-msg h1{font-size:calc(var(--u)*56);font-weight:800;color:var(--text);margin:calc(var(--u)*20) 0 calc(var(--u)*12)}
  #nk .nk-msg p{font-size:calc(var(--u)*30);max-width:24em;line-height:1.4}
  #nk .nk-msg .nk-ic.big{width:calc(var(--u)*72);height:calc(var(--u)*72);color:var(--warn)}
  @media (prefers-reduced-motion: reduce){#nk .nk-rooms.swap{animation:none}}
  /* Night: Catppuccin Mocha, so a lit corridor TV doesn't glare at 3 am. All pairs AA. */
  #nk.night{--base:#1e1e2e;--mantle:#181825;--crust:#313244;--s1:#585b70;--text:#cdd6f4;--sub:#a6adc8;
    --op:#a6e3a1;--ane:#89b4fa;--usk:#94e2d5;--tsk:#a6e3a1;--stod:#cba6f7;--badge-ink:#11111b;--warn:#fab387;--red:#f38ba8;
    --live:#a6e3a1;--card:#262637;--track:#313244}
  #nk.night .nk-tag.warn,#nk.night .nk-stale{color:#11111b}
  #nk.night .nk-pool.empty,#nk.night .nk-room.empty{opacity:.85}
  #nk-tg{position:fixed;right:12px;bottom:12px;z-index:2147483647;font:600 13px system-ui;background:#4c4f69;color:#eff1f5;border:0;border-radius:999px;padding:8px 14px;cursor:pointer;opacity:.7}`;

  /* ---------- mount ---------- */
  document.getElementById('nk-style')?.remove();
  document.getElementById('nk')?.remove();
  document.getElementById('nk-tg')?.remove();
  const st = document.createElement('style'); st.id = 'nk-style'; st.textContent = css; document.head.appendChild(st);
  const el = document.createElement('div'); el.id = 'nk'; document.body.appendChild(el);
  const htmlOverflow = document.documentElement.style.overflow;
  document.documentElement.style.overflow = 'hidden'; /* no scrollbar from TESSA's page behind the board */
  if (!KIOSK) {
    const b = document.createElement('button'); b.id = 'nk-tg'; b.textContent = '⇄ TESSA';
    b.onclick = () => { el.style.display = el.style.display === 'none' ? '' : 'none'; };
    document.body.appendChild(b);
  }

  /* ---------- keep on the right day ----------
     Which day TESSA shows is read from the Dagblad header itself, not the URL, so a URL change
     that TESSA ignores is caught. First try TESSA's router; if the page still shows the wrong
     day 30 s later, press TESSA's own day arrow, the same as a person would. Never reloads,
     so the board keeps running. Gives up after four tries a day rather than looping. */
  const MONTHS = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'];
  function headerDtm() {
    const m = /(\d{1,2})\s+([a-zåäö]+)\s+(\d{4})/i.exec(txt(document, '.otb-main-name-header'));
    const mi = m ? MONTHS.indexOf(m[2].toLowerCase()) : -1;
    return mi < 0 ? null : Date.UTC(+m[3], mi, +m[1]) / 864e5;
  }
  function targetDtm() {
    const at = mins(NEXT_DAY_AT);
    return todayDtm() + (at > 0 && nowMins(new Date()) >= at ? 1 : 0);
  }
  function ensureToday() {
    if (!AUTO_TODAY) return;
    const want = targetDtm();
    const have = headerDtm() ?? +new URLSearchParams(location.search).get('viewDtm');
    if (state.want !== want) { state.want = want; state.tries = 0; }
    if (have === want || state.tries >= 4) return;
    state.tries++;
    try {
      if (state.tries === 1 && window.FlowRouter?.setQueryParams) { FlowRouter.setQueryParams({ viewDtm: String(want) }); return; }
    } catch (e) {}
    const step = want - have;
    const arrow = step === 1 ? $('.js-select-next-day') : step === -1 ? $('.js-select-previous-day') : null;
    if (arrow) arrow.click();
    else { try { window.FlowRouter?.setQueryParams?.({ viewDtm: String(want) }); } catch (e) {} }
  }

  /* ---------- live updates ---------- */
  let tmo;
  const update = () => { clearTimeout(tmo); tmo = setTimeout(() => render(parse()), 400); };
  function watch() {
    state.obs?.disconnect();
    const target = $('#otb') || document.body;
    state.obs = new MutationObserver(m => { if (!m.every(x => el.contains(x.target))) { state.lastChange = new Date(); update(); } });
    state.obs.observe(target, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'value'] });
  }

  ensureToday();
  render(parse());
  watch();
  state.timers.push(setInterval(() => { ensureToday(); if (!state.obs || !document.contains($('#otb'))) watch(); render(parse()); }, 30000));
  addEventListener('resize', fit);

  window.__nk = {
    stop() { document.documentElement.style.overflow = htmlOverflow; state.timers.forEach(clearInterval); state.obs?.disconnect(); removeEventListener('resize', fit); el.remove(); st.remove(); document.getElementById('nk-tg')?.remove(); },
    data: parse,
  };
  console.log('%cNarkos Dagblad portrait v4.6 running', 'color:#40a02b;font-weight:bold');
})();
