/* ============================================================
   Narkos Dagblad — Portrait TV  v4.2
   DevTools Snippet for TESSA Dagblad (tessa.sematic.se)
   Read-only overlay: never writes, clicks or submits in TESSA.
   Designed for a 1080×1920 portrait screen, scales to any size.
   ============================================================ */
(() => {
  /* ---------- settings ---------- */
  const KIOSK = true;          /* true = no buttons, hidden cursor. false = debug toggle visible */
  const SHORT_NAMES = true;    /* "Anna Karin Svensson" -> "Anna KS" */
  const HIDE_ABSENT_REASON = true; /* never show comments/reasons for absent staff */
  const AUTO_TODAY = true;     /* keep the board on today's date (also at midnight) */

  /* ---------- re-run safety ---------- */
  if (window.__nk) { try { window.__nk.stop(); } catch (e) {} }
  const state = { timers: [], obs: null, lastChange: null, lostAt: null };

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
      leads: [], rooms: [], pools: [], absent: [], times: {}, headerCount: $$('.otb-station-header').length,
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
          if (time && !absent) data.times[time] = (data.times[time] || 0) + 1;
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

    /* most common shift time — only deviations get shown */
    data.stdTime = Object.entries(data.times).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    return data;
  }

  /* ---------- render ---------- */
  const badgeCls = { ANE: 'b-ane', OP: 'b-op', USK: 'b-usk', TSK: 'b-usk', 'STÖD': 'b-stod' };

  /* Small line icons (one stroke family) instead of emoji, so they render the same on every PC. */
  const svg = (d, cls) => `<svg class="nk-ic ${cls || ''}" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
  const IC = {
    phone: 'M6.6 3.5h2.6l1.4 4.3-2 1.6a12 12 0 0 0 6 6l1.6-2 4.3 1.4v2.6a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.6 5.7a2 2 0 0 1 2-2.2z',
    clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
    alert: 'M12 3.5 2.5 20h19L12 3.5zM12 10v4.5M12 17.3v.2',
  };

  function person(r, std, colRole) {
    const extra = r.roles.filter(x => x !== colRole);
    const badges = extra.map(x => `<span class="nk-b ${badgeCls[x] || 'b-usk'}">${esc(x)}</span>`).join('');
    const time = r.time && r.time !== std ? `<span class="nk-time">${svg(IC.clock)}${esc(r.time.replace(/-/, '–'))}</span>` : '';
    /* time sits on the second line so names never get cut off */
    const sub = [time, r.note && `<span class="nk-note">${esc(r.note)}</span>`, r.comment && `<span class="nk-cmt">${esc(r.comment)}</span>`].filter(Boolean).join('');
    return `<div class="nk-p${r.fiktiv ? ' fik' : ''}">
      <div class="nk-pl"><i class="nk-dot${r.online ? ' on' : ''}"></i><span class="nk-n">${esc(r.short)}</span>${badges}</div>
      ${sub ? `<div class="nk-sub">${sub}</div>` : ''}</div>`;
  }

  const hm = t => t ? t.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }) : '';

  function message(title, body) {
    document.getElementById('nk').innerHTML = `<div class="nk-msg"><div>${svg(IC.alert, 'big')}<h1>${title}</h1><p>${body}</p></div></div>`;
  }

  function render(d) {
    const el = document.getElementById('nk');
    const c = conn();
    if (!c.logged) return message('TESSA är utloggad', 'Logga in på enhetskontot och klicka på bokmärket 📺&nbsp;TV-läge igen.');
    if (!d) return message('Väntar på TESSA…', 'Öppna Dagblad i TESSA. Tavlan visas när sidan har laddat.');
    if (!d.headerCount) return message('Kunde inte läsa Dagbladet', 'TESSA kan ha ändrat sidans uppbyggnad. Tavlan visar inget hellre än fel bemanning – säg till den som satte upp tavlan.');

    const std = d.stdTime;
    const now = new Date();
    const isToday = new URLSearchParams(location.search).get('viewDtm') == String(todayDtm());
    if (!c.ok && !state.lostAt) state.lostAt = now;
    if (c.ok) state.lostAt = null;
    /* Meteor reconnects on its own after short blips, so only warn after a minute without contact. */
    const lost = !!state.lostAt && now - state.lostAt > 60000;

    const lead = side => {
      const label = `<span class="nk-lt">VL ${side === 'ane' ? 'Ane' : 'Op'}</span>`;
      const tel = t => t ? `<span class="nk-tel">${svg(IC.phone)}${esc(t)}</span>` : '';
      const rows = d.leads.filter(l => l.side === side);
      if (!rows.length) return `<div class="nk-lead ${side} none">${label}<span class="nk-ln">—</span>${tel((d.leadPhones?.[side] || [])[0])}</div>`;
      return rows.map(l => `<div class="nk-lead ${side}">${label}<span class="nk-ln">${esc(l.short)}</span>${tel(l.tel)}</div>`).join('');
    };

    const room = r => `
      <section class="nk-room${r.robot ? ' robot' : ''}${r.empty ? ' empty' : ''}">
        <div class="nk-rid">
          <div class="nk-num">${esc(r.id)}</div>
          ${r.kvall ? '<div><span class="nk-kv">Kväll</span></div>' : ''}
          ${r.ph.op.length ? `<div class="nk-rph"><b>Op</b><span>${r.ph.op.map(n => `<span>${esc(n)}</span>`).join('')}</span></div>` : ''}
          ${r.ph.ane.length ? `<div class="nk-rph"><b>Ane</b><span>${r.ph.ane.map(n => `<span>${esc(n)}</span>`).join('')}</span></div>` : ''}
        </div>
        <div class="nk-col op"><div class="nk-ch">Op</div>${r.op.map(p => person(p, std, 'OP')).join('') || '<div class="nk-none">Ingen</div>'}</div>
        <div class="nk-col ane"><div class="nk-ch">Ane</div>${r.ane.map(p => person(p, std, 'ANE')).join('') || '<div class="nk-none">Ingen</div>'}</div>
        ${r.bulletin ? `<div class="nk-bull">${esc(r.bulletin)}</div>` : ''}
      </section>`;

    const pool = p => `
      <section class="nk-pool${p.rows.length ? '' : ' empty'}">
        <h3>${esc(p.name)}${p.kvall ? '<span class="nk-kv">Kväll</span>' : ''}</h3>
        ${p.bulletin ? `<div class="nk-bull">${esc(p.bulletin)}</div>` : ''}
        ${p.rows.map(x => person(x, std, null)).join('') || '<div class="nk-none">Ingen</div>'}
      </section>`;

    const absent = d.absent.length ? `
      <footer class="nk-abs"><span class="nk-at">Frånvaro</span>
        ${d.absent.map(a => `<span class="nk-ai">${esc(a.short)}${!HIDE_ABSENT_REASON && a.comment ? ` <em>${esc(a.comment)}</em>` : ''}</span>`).join('')}
      </footer>` : '';

    /* Honest freshness: Meteor's own connection state, and when TESSA last changed the page. */
    const status = !lost
      ? `<i class="nk-dot on"></i> Live från TESSA${state.lastChange ? ` · senaste ändring ${hm(state.lastChange)}` : ''}`
      : `<i class="nk-dot"></i> Ingen kontakt med TESSA sedan ${hm(state.lostAt)}`;

    el.innerHTML = `
      <div class="nk-page">
        ${!lost ? '' : `<div class="nk-stale">${svg(IC.alert)}Ingen kontakt med TESSA sedan ${hm(state.lostAt)} – tavlan visar senast kända läge.</div>`}
        <header class="nk-top">
          <div class="nk-date"><div class="nk-day">${esc(d.day)}${isToday ? '' : ' <span class="nk-warn">Ej idag</span>'}</div><div class="nk-dm">${esc(d.date)} · v.${esc(d.week)}</div></div>
          <div class="nk-right">
            ${d.deficit ? `<div class="nk-def">${svg(IC.alert)}${esc(d.deficit.replace(/⚠️|⚠/g, '').trim())}</div>` : ''}
            <div class="nk-clock">${hm(now)}</div>
          </div>
        </header>
        <div class="nk-leads">${lead('ane')}${lead('op')}</div>
        ${std ? `<div class="nk-std">Standardpass ${esc(std.replace(/-/, '–'))} · bara avvikande tider visas</div>` : ''}
        <main class="nk-rooms">${d.rooms.map(room).join('')}</main>
        <div class="nk-pools">${d.pools.map(pool).join('')}</div>
        ${absent}
        <div class="nk-upd">${status} <span class="nk-sep">·</span> <i class="nk-dot on"></i> inloggad <i class="nk-dot"></i> ej inloggad</div>
      </div>`;
    fit();
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

  /* ---------- styles (Catppuccin Latte, inks darkened for reading at distance) ---------- */
  const css = `
  #nk{--base:#eff1f5;--mantle:#e6e9ef;--crust:#dce0e8;--s1:#bcc0cc;--text:#4c4f69;--sub:#5c5f77;
    --op:#2a731c;--ane:#1650d4;--usk:#0d6e73;--stod:#6b21c8;--time:#a8420a;--note:#3d4cc0;--warn:#a8420a;--red:#b0102f;
    --live:#40a02b;--kv:#5b67c9;--note-bg:#f6e9d3;--note-ink:#7a4f0c;
    --u:1px;position:fixed;inset:0;z-index:2147483646;background:var(--base);color:var(--text);overflow:hidden;
    font-family:"Segoe UI Variable Text","Segoe UI",system-ui,-apple-system,sans-serif;font-variant-numeric:tabular-nums;
    font-size:calc(var(--u)*26);line-height:1.25;-webkit-font-smoothing:antialiased;${KIOSK ? 'cursor:none;' : ''}}
  #nk *{box-sizing:border-box;margin:0}
  #nk ::selection{background:#1650d433}
  #nk .nk-ic{width:1em;height:1em;flex:none;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;vertical-align:-.12em}
  #nk .nk-page{padding:calc(var(--u)*36) calc(var(--u)*36) calc(var(--u)*20);display:flex;flex-direction:column;gap:calc(var(--u)*16)}
  #nk .nk-stale{display:flex;align-items:center;gap:.5em;background:var(--warn);color:#fff;font-size:calc(var(--u)*28);font-weight:700;border-radius:calc(var(--u)*16);padding:calc(var(--u)*14) calc(var(--u)*20)}
  #nk .nk-top{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:calc(var(--u)*3) solid var(--crust);padding-bottom:calc(var(--u)*14)}
  #nk .nk-day{font-size:calc(var(--u)*72);font-weight:800;letter-spacing:-.02em;line-height:1}
  #nk .nk-dm{font-size:calc(var(--u)*32);color:var(--sub);margin-top:calc(var(--u)*6)}
  #nk .nk-warn{font-size:calc(var(--u)*26);background:var(--warn);color:#fff;border-radius:999px;padding:.15em .6em;vertical-align:middle}
  #nk .nk-right{display:flex;align-items:center;gap:calc(var(--u)*24)}
  #nk .nk-clock{font-size:calc(var(--u)*100);font-weight:300;line-height:.9;letter-spacing:-.03em}
  #nk .nk-def{display:flex;align-items:center;gap:.3em;font-size:calc(var(--u)*30);font-weight:700;color:var(--warn);background:#fe640b1f;border-radius:calc(var(--u)*14);padding:.3em .6em}
  #nk .nk-leads{display:grid;grid-template-columns:1fr 1fr;gap:calc(var(--u)*14)}
  #nk .nk-lead{display:flex;align-items:baseline;gap:calc(var(--u)*12);background:var(--mantle);border-radius:calc(var(--u)*18);padding:calc(var(--u)*16) calc(var(--u)*22)}
  #nk .nk-lt{font-size:calc(var(--u)*20);font-weight:800;text-transform:uppercase;letter-spacing:.06em;white-space:nowrap}
  #nk .ane .nk-lt{color:var(--ane)} #nk .op .nk-lt{color:var(--op)}
  #nk .nk-ln{font-size:calc(var(--u)*34);font-weight:700;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #nk .nk-tel{display:flex;align-items:center;gap:.25em;font-size:calc(var(--u)*36);font-weight:800}
  #nk .nk-tel .nk-ic{width:.8em;height:.8em}
  #nk .nk-std{font-size:calc(var(--u)*20);color:var(--sub);text-align:right;margin-top:calc(var(--u)*-4)}
  #nk .nk-rooms{display:flex;flex-direction:column;gap:calc(var(--u)*12)}
  #nk .nk-room{display:grid;grid-template-columns:calc(var(--u)*220) 1.15fr 1fr;background:#fff;border-radius:calc(var(--u)*22);
    box-shadow:0 calc(var(--u)*2) calc(var(--u)*10) #4c4f6914;overflow:hidden}
  #nk .nk-room.empty{opacity:.5}
  #nk .nk-rid{background:var(--mantle);padding:calc(var(--u)*16) calc(var(--u)*20);display:flex;flex-direction:column;justify-content:center;gap:calc(var(--u)*5)}
  #nk .nk-num{font-size:calc(var(--u)*64);font-weight:800;letter-spacing:-.03em;line-height:1}
  #nk .robot .nk-num{font-size:calc(var(--u)*46)}
  #nk .nk-rph{display:flex;align-items:baseline;gap:.4em;font-size:calc(var(--u)*23);font-weight:600;color:var(--text)}
  #nk .nk-rph b{min-width:2.4em;font-weight:800;font-size:.72em;text-transform:uppercase;letter-spacing:.06em;color:var(--sub)}
  #nk .nk-rph>span{display:flex;flex-wrap:wrap;column-gap:.5em}
  #nk .nk-col{padding:calc(var(--u)*14) calc(var(--u)*20);display:flex;flex-direction:column;gap:calc(var(--u)*8)}
  #nk .nk-col.ane{border-left:calc(var(--u)*2) solid var(--crust)}
  #nk .nk-ch{font-size:calc(var(--u)*19);font-weight:800;text-transform:uppercase;letter-spacing:.1em}
  #nk .op .nk-ch{color:var(--op)} #nk .ane .nk-ch{color:var(--ane)}
  #nk .nk-p{display:flex;flex-direction:column}
  #nk .nk-pl{display:flex;align-items:center;gap:calc(var(--u)*10);min-width:0}
  #nk .nk-n{font-size:calc(var(--u)*32);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #nk .fik .nk-n{font-style:italic;color:var(--sub);font-weight:500}
  #nk .nk-dot{flex:none;width:calc(var(--u)*13);height:calc(var(--u)*13);border-radius:50%;background:var(--s1)}
  #nk .nk-dot.on{background:var(--live)}
  #nk .nk-b{flex:none;font-size:calc(var(--u)*18);font-weight:800;letter-spacing:.04em;border-radius:calc(var(--u)*7);padding:.12em .42em;color:#fff}
  #nk .b-ane{background:var(--ane)} #nk .b-op{background:var(--op)} #nk .b-usk{background:var(--usk)} #nk .b-stod{background:var(--stod)}
  #nk .nk-sub{display:flex;flex-wrap:wrap;align-items:baseline;gap:calc(var(--u)*4) calc(var(--u)*12);padding-left:calc(var(--u)*23);margin-top:calc(var(--u)*2);line-height:1.3}
  #nk .nk-time{display:inline-flex;align-items:center;gap:.25em;font-size:calc(var(--u)*23);font-weight:700;color:var(--time)}
  #nk .nk-time .nk-ic{width:.85em;height:.85em}
  #nk .nk-note{font-size:calc(var(--u)*22);font-weight:700;color:var(--note)}
  #nk .nk-cmt{font-size:calc(var(--u)*22);color:var(--note-ink);background:var(--note-bg);border-radius:calc(var(--u)*6);padding:0 .35em}
  #nk .nk-none{font-size:calc(var(--u)*24);color:var(--sub);font-style:italic}
  #nk .nk-bull{grid-column:1/-1;background:var(--note-bg);color:var(--note-ink);font-size:calc(var(--u)*23);font-weight:700;padding:calc(var(--u)*10) calc(var(--u)*20)}
  #nk .nk-kv{display:inline-block;font-size:calc(var(--u)*17);font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:#fff;background:var(--kv);border-radius:999px;padding:.15em .6em}
  #nk .nk-pool h3 .nk-kv{margin-left:.6em;vertical-align:.1em}
  #nk .nk-pools{display:grid;grid-template-columns:1fr 1fr;gap:calc(var(--u)*12)}
  #nk.compact .nk-pools{grid-template-columns:1fr 1fr 1fr}
  #nk .nk-pool{background:var(--mantle);border-radius:calc(var(--u)*20);padding:calc(var(--u)*16) calc(var(--u)*20);display:flex;flex-direction:column;gap:calc(var(--u)*8)}
  #nk .nk-pool.empty{opacity:.6}
  #nk .nk-pool h3{font-size:calc(var(--u)*19);font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--sub)}
  #nk .nk-pool .nk-n{font-size:calc(var(--u)*28)}
  #nk .nk-abs{display:flex;flex-wrap:wrap;align-items:center;gap:calc(var(--u)*8) calc(var(--u)*10);background:#f9e6ea;border-radius:calc(var(--u)*18);padding:calc(var(--u)*14) calc(var(--u)*20)}
  #nk .nk-at{font-size:calc(var(--u)*19);font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--red);margin-right:calc(var(--u)*6)}
  #nk .nk-ai{font-size:calc(var(--u)*25);color:var(--text);background:#fff;border-radius:999px;padding:.1em .65em;text-decoration:line-through;text-decoration-color:#b0102f80;text-decoration-thickness:.08em}
  #nk .nk-upd{font-size:calc(var(--u)*18);color:var(--sub);display:flex;align-items:center;justify-content:center;gap:calc(var(--u)*7)}
  #nk .nk-upd .nk-dot{width:calc(var(--u)*11);height:calc(var(--u)*11)}
  #nk .nk-sep{margin:0 calc(var(--u)*6)}
  #nk .nk-msg{position:absolute;inset:0;display:grid;place-content:center;text-align:center;padding:10%;color:var(--sub)}
  #nk .nk-msg h1{font-size:calc(var(--u)*56);font-weight:800;color:var(--text);margin:calc(var(--u)*20) 0 calc(var(--u)*12)}
  #nk .nk-msg p{font-size:calc(var(--u)*30);max-width:24em;line-height:1.4}
  #nk .nk-msg .nk-ic.big{width:calc(var(--u)*72);height:calc(var(--u)*72);color:var(--warn)}
  #nk-tg{position:fixed;right:12px;bottom:12px;z-index:2147483647;font:600 13px system-ui;background:#4c4f69;color:#eff1f5;border:0;border-radius:999px;padding:8px 14px;cursor:pointer;opacity:.7}`;

  /* ---------- mount ---------- */
  document.getElementById('nk-style')?.remove();
  document.getElementById('nk')?.remove();
  document.getElementById('nk-tg')?.remove();
  const st = document.createElement('style'); st.id = 'nk-style'; st.textContent = css; document.head.appendChild(st);
  const el = document.createElement('div'); el.id = 'nk'; document.body.appendChild(el);
  if (!KIOSK) {
    const b = document.createElement('button'); b.id = 'nk-tg'; b.textContent = '⇄ TESSA';
    b.onclick = () => { el.style.display = el.style.display === 'none' ? '' : 'none'; };
    document.body.appendChild(b);
  }

  /* ---------- keep on today (no reload, so the snippet survives) ---------- */
  function ensureToday() {
    if (!AUTO_TODAY) return;
    const want = String(todayDtm());
    if (new URLSearchParams(location.search).get('viewDtm') === want) return;
    try {
      if (window.FlowRouter?.setQueryParams) { FlowRouter.setQueryParams({ viewDtm: want }); return; }
    } catch (e) {}
    if (sessionStorage.getItem('nk-jump') !== want) { /* last-resort fallback */
      sessionStorage.setItem('nk-jump', want);
      const u = new URL(location.href); u.searchParams.set('viewDtm', want); location.replace(u);
    }
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
    stop() { state.timers.forEach(clearInterval); state.obs?.disconnect(); removeEventListener('resize', fit); el.remove(); st.remove(); document.getElementById('nk-tg')?.remove(); },
    data: parse,
  };
  console.log('%cNarkos Dagblad portrait v4.2 running', 'color:#40a02b;font-weight:bold');
})();
