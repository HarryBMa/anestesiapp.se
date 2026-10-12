/* ============================================================
   Narkos Dagblad — Portrait TV  v4.1
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
  const state = { timers: [], obs: null };

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

  /* ---------- parse TESSA DOM ---------- */
  function parse() {
    const root = $('#otb');
    if (!root) return null;
    const header = txt(document, '.otb-main-name-header'); /* "Dag: Fredag 9 Oktober 2026, Vecka 41" */
    const hm = header.match(/:\s*(\S+)\s+(\d+)\s+(\S+)\s+(\d{4}),\s*Vecka\s*(\d+)/i);
    const data = {
      day: hm ? hm[1] : '', date: hm ? `${hm[2]} ${hm[3].toLowerCase()}` : header,
      week: hm ? hm[5] : '', deficit: txt(document, '.otb-time-deficit'),
      leads: [], rooms: [], pools: [], absent: [], times: {},
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

  function person(r, std, colRole) {
    const extra = r.roles.filter(x => x !== colRole);
    const badges = extra.map(x => `<span class="nk-b ${badgeCls[x] || 'b-usk'}">${esc(x)}</span>`).join('');
    const time = r.time && r.time !== std ? `<span class="nk-time">${esc(r.time.replace(/-/, '–'))}</span>` : '';
    /* time sits on the second line so names never get cut off */
    const sub = [time, r.note && `<span class="nk-note">${esc(r.note)}</span>`, r.comment && `<span class="nk-cmt">${esc(r.comment)}</span>`].filter(Boolean).join('');
    return `<div class="nk-p${r.fiktiv ? ' fik' : ''}">
      <div class="nk-pl"><i class="nk-dot${r.online ? ' on' : ''}"></i><span class="nk-n">${esc(r.short)}</span>${badges}</div>
      ${sub ? `<div class="nk-sub">${sub}</div>` : ''}</div>`;
  }

  function render(d) {
    const el = document.getElementById('nk');
    if (!d) { el.innerHTML = `<div class="nk-msg">TESSA verkar utloggad eller laddar…<br><small>Logga in igen på enhetskontot.</small></div>`; return; }
    const std = d.stdTime;
    const now = new Date();
    const hhmm = now.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
    const isToday = new URLSearchParams(location.search).get('viewDtm') == String(todayDtm());

    const lead = side => d.leads.filter(l => l.side === side).map(l => `
      <div class="nk-lead ${side}">
        <span class="nk-lt">VL ${side === 'ane' ? 'Ane' : 'Op'}</span>
        <span class="nk-ln">${esc(l.short)}</span>
        ${l.tel ? `<span class="nk-tel">☎ ${esc(l.tel)}</span>` : ''}
      </div>`).join('') || `<div class="nk-lead ${side} none"><span class="nk-lt">VL ${side === 'ane' ? 'Ane' : 'Op'}</span><span class="nk-ln">—</span>${(d.leadPhones?.[side] || [])[0] ? `<span class="nk-tel">☎ ${d.leadPhones[side][0]}</span>` : ''}</div>`;

    const room = r => `
      <section class="nk-room${r.robot ? ' robot' : ''}${r.empty ? ' empty' : ''}">
        <div class="nk-rid">
          <div class="nk-num">${esc(r.id)}${r.kvall ? '<span class="nk-kv">KVÄLL</span>' : ''}</div>
          ${r.ph.op.length ? `<div class="nk-rph"><b>OP</b> ${r.ph.op.map(esc).join(' · ')}</div>` : ''}
          ${r.ph.ane.length ? `<div class="nk-rph"><b>ANE</b> ${r.ph.ane.map(esc).join(' · ')}</div>` : ''}
        </div>
        <div class="nk-col op"><div class="nk-ch">Op</div>${r.op.map(p => person(p, std, 'OP')).join('') || '<div class="nk-none">—</div>'}</div>
        <div class="nk-col ane"><div class="nk-ch">Ane</div>${r.ane.map(p => person(p, std, 'ANE')).join('') || '<div class="nk-none">—</div>'}</div>
        ${r.bulletin ? `<div class="nk-bull">${esc(r.bulletin)}</div>` : ''}
      </section>`;

    const pool = p => `
      <section class="nk-pool">
        <h3>${esc(p.name)}${p.kvall ? '<span class="nk-kv">KVÄLL</span>' : ''}</h3>
        ${p.bulletin ? `<div class="nk-bull">${esc(p.bulletin)}</div>` : ''}
        ${p.rows.map(x => person(x, std, null)).join('') || '<div class="nk-none">—</div>'}
      </section>`;

    const absent = d.absent.length ? `
      <footer class="nk-abs"><span class="nk-at">Frånvaro</span>
        ${d.absent.map(a => `<span class="nk-ai">${esc(a.short)}${!HIDE_ABSENT_REASON && a.comment ? ` <em>${esc(a.comment)}</em>` : ''}</span>`).join('')}
      </footer>` : '';

    el.innerHTML = `
      <div class="nk-page">
        <header class="nk-top">
          <div class="nk-date"><div class="nk-day">${esc(d.day)}${isToday ? '' : ' <span class="nk-warn">ej idag</span>'}</div><div class="nk-dm">${esc(d.date)} · v.${esc(d.week)}</div></div>
          <div class="nk-right">
            ${d.deficit ? `<div class="nk-def" title="Tidsdeficit i TESSA">${esc(d.deficit)}</div>` : ''}
            <div class="nk-clock">${hhmm}</div>
          </div>
        </header>
        <div class="nk-leads">${lead('ane')}${lead('op')}</div>
        ${std ? `<div class="nk-std">Standardpass ${esc(std.replace(/-/, '–'))} · avvikande tider visas</div>` : ''}
        <main class="nk-rooms">${d.rooms.map(room).join('')}</main>
        <div class="nk-pools">${d.pools.map(pool).join('')}</div>
        ${absent}
        <div class="nk-upd"><i class="nk-dot on"></i> inloggad · <i class="nk-dot"></i> ej inloggad · Uppdaterad ${hhmm} · live från TESSA</div>
      </div>`;
    fit();
  }

  /* shrink until everything fits on one screen (no scrolling on a TV) */
  function fit() {
    const el = document.getElementById('nk');
    const page = el.querySelector('.nk-page');
    if (!page) return;
    let u = Math.min(innerWidth / 1080, innerHeight / 1920);
    el.style.setProperty('--u', u + 'px');
    for (let i = 0; i < 25 && page.scrollHeight > innerHeight; i++) {
      u *= 0.96; el.style.setProperty('--u', u + 'px');
    }
  }

  /* ---------- styles (Catppuccin Latte) ---------- */
  const css = `
  #nk{--base:#eff1f5;--mantle:#e6e9ef;--crust:#dce0e8;--s0:#ccd0da;--s1:#bcc0cc;--text:#4c4f69;--sub:#6c6f85;--ov:#9ca0b0;
    --blue:#1e66f5;--green:#40a02b;--teal:#179299;--mauve:#8839ef;--yellow:#df8e1d;--peach:#fe640b;--red:#d20f39;--lav:#7287fd;
    --u:1px;position:fixed;inset:0;z-index:2147483646;background:var(--base);color:var(--text);overflow:hidden;
    font-family:"Inter","Segoe UI Variable Text","Segoe UI",system-ui,sans-serif;font-variant-numeric:tabular-nums;
    font-size:calc(var(--u)*26);line-height:1.2;${KIOSK ? 'cursor:none;' : ''}}
  #nk *{box-sizing:border-box;margin:0}
  #nk .nk-page{padding:calc(var(--u)*36) calc(var(--u)*36) calc(var(--u)*20);display:flex;flex-direction:column;gap:calc(var(--u)*18)}
  #nk .nk-top{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:calc(var(--u)*3) solid var(--crust);padding-bottom:calc(var(--u)*14)}
  #nk .nk-day{font-size:calc(var(--u)*72);font-weight:800;letter-spacing:-.02em;line-height:1}
  #nk .nk-dm{font-size:calc(var(--u)*32);color:var(--sub);margin-top:calc(var(--u)*6)}
  #nk .nk-warn{font-size:calc(var(--u)*26);background:var(--peach);color:#fff;border-radius:999px;padding:.15em .6em;vertical-align:middle}
  #nk .nk-right{display:flex;align-items:center;gap:calc(var(--u)*20)}
  #nk .nk-clock{font-size:calc(var(--u)*96);font-weight:300;line-height:1;letter-spacing:-.03em}
  #nk .nk-def{font-size:calc(var(--u)*30);font-weight:700;color:var(--peach);background:#fe640b1a;border-radius:calc(var(--u)*14);padding:.3em .6em}
  #nk .nk-leads{display:grid;grid-template-columns:1fr 1fr;gap:calc(var(--u)*14)}
  #nk .nk-lead{display:flex;align-items:baseline;gap:calc(var(--u)*12);background:var(--mantle);border-radius:calc(var(--u)*18);padding:calc(var(--u)*14) calc(var(--u)*20);border-left:calc(var(--u)*8) solid var(--blue)}
  #nk .nk-lead.op{border-left-color:var(--green)}
  #nk .nk-lt{font-size:calc(var(--u)*20);font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--sub)}
  #nk .nk-ln{font-size:calc(var(--u)*32);font-weight:700;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #nk .nk-tel{font-size:calc(var(--u)*34);font-weight:800}
  #nk .nk-std{font-size:calc(var(--u)*20);color:var(--ov);text-align:right;margin-top:calc(var(--u)*-6)}
  #nk .nk-rooms{display:flex;flex-direction:column;gap:calc(var(--u)*12)}
  #nk .nk-room{display:grid;grid-template-columns:calc(var(--u)*230) 1fr 1fr;background:#fff;border-radius:calc(var(--u)*22);
    box-shadow:0 calc(var(--u)*2) calc(var(--u)*8) #4c4f6912;overflow:hidden}
  #nk .nk-room.empty{opacity:.45}
  #nk .nk-rid{background:var(--mantle);padding:calc(var(--u)*16) calc(var(--u)*18);display:flex;flex-direction:column;justify-content:center;gap:calc(var(--u)*4)}
  #nk .nk-num{font-size:calc(var(--u)*64);font-weight:800;letter-spacing:-.03em;line-height:1}
  #nk .robot .nk-num{font-size:calc(var(--u)*44)}
  #nk .nk-rph{font-size:calc(var(--u)*19);color:var(--sub)}
  #nk .nk-rph b{font-weight:700;font-size:.85em;color:var(--ov);margin-right:.2em}
  #nk .nk-col{padding:calc(var(--u)*12) calc(var(--u)*18);display:flex;flex-direction:column;gap:calc(var(--u)*6)}
  #nk .nk-col.ane{border-left:calc(var(--u)*2) solid var(--crust)}
  #nk .nk-ch{font-size:calc(var(--u)*17);font-weight:800;text-transform:uppercase;letter-spacing:.1em}
  #nk .op .nk-ch{color:var(--green)} #nk .ane .nk-ch{color:var(--blue)}
  #nk .nk-p{display:flex;flex-direction:column}
  #nk .nk-pl{display:flex;align-items:center;gap:calc(var(--u)*9);min-width:0}
  #nk .nk-n{font-size:calc(var(--u)*31);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #nk .fik .nk-n{font-style:italic;color:var(--sub);font-weight:500}
  #nk .nk-dot{flex:none;width:calc(var(--u)*13);height:calc(var(--u)*13);border-radius:50%;background:var(--s1)}
  #nk .nk-dot.on{background:var(--green);box-shadow:0 0 0 calc(var(--u)*4) #40a02b2e}
  #nk .nk-b{flex:none;font-size:calc(var(--u)*16);font-weight:800;letter-spacing:.05em;border-radius:calc(var(--u)*7);padding:.15em .45em;color:#fff}
  #nk .b-ane{background:var(--blue)} #nk .b-op{background:var(--green)} #nk .b-usk{background:var(--teal)} #nk .b-stod{background:var(--mauve)}
  #nk .nk-time{flex:none;font-size:calc(var(--u)*20);font-weight:700;color:var(--peach);background:#fe640b14;border-radius:calc(var(--u)*8);padding:.1em .4em}
  #nk .nk-sub{display:flex;flex-wrap:wrap;gap:calc(var(--u)*6);padding-left:calc(var(--u)*22);margin-top:calc(var(--u)*2)}
  #nk .nk-note{font-size:calc(var(--u)*19);font-weight:700;color:var(--lav)}
  #nk .nk-cmt{font-size:calc(var(--u)*19);color:#8a5a0e;background:#df8e1d22;border-radius:calc(var(--u)*6);padding:0 .35em}
  #nk .nk-none{font-size:calc(var(--u)*26);color:var(--s1)}
  #nk .nk-bull{grid-column:1/-1;background:#df8e1d26;color:#7a4f0c;font-size:calc(var(--u)*21);font-weight:600;padding:calc(var(--u)*8) calc(var(--u)*18)}
  #nk .nk-kv{font-size:calc(var(--u)*15);font-weight:800;letter-spacing:.08em;color:#fff;background:var(--lav);border-radius:999px;padding:.15em .55em;margin-left:.5em;vertical-align:middle}
  #nk .nk-pools{display:grid;grid-template-columns:1fr 1fr;gap:calc(var(--u)*12)}
  #nk .nk-pool{background:var(--mantle);border-radius:calc(var(--u)*20);padding:calc(var(--u)*14) calc(var(--u)*18);display:flex;flex-direction:column;gap:calc(var(--u)*6)}
  #nk .nk-pool h3{font-size:calc(var(--u)*19);font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--sub);margin-bottom:calc(var(--u)*2)}
  #nk .nk-pool .nk-n{font-size:calc(var(--u)*27)}
  #nk .nk-abs{display:flex;flex-wrap:wrap;align-items:center;gap:calc(var(--u)*8) calc(var(--u)*10);background:#d20f390d;border-radius:calc(var(--u)*18);padding:calc(var(--u)*12) calc(var(--u)*18)}
  #nk .nk-at{font-size:calc(var(--u)*19);font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--red);margin-right:calc(var(--u)*6)}
  #nk .nk-ai{font-size:calc(var(--u)*24);color:var(--sub);background:#fff;border-radius:999px;padding:.12em .65em;text-decoration:line-through;text-decoration-color:#d20f3966}
  #nk .nk-upd{font-size:calc(var(--u)*17);color:var(--ov);display:flex;align-items:center;justify-content:center;gap:calc(var(--u)*6)}
  #nk .nk-upd .nk-dot{width:calc(var(--u)*10);height:calc(var(--u)*10);box-shadow:none}
  #nk .nk-msg{position:absolute;inset:0;display:grid;place-content:center;text-align:center;font-size:calc(var(--u)*44);color:var(--sub)}
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
    state.obs = new MutationObserver(m => { if (!m.every(x => el.contains(x.target))) update(); });
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
  console.log('%cNarkos Dagblad portrait v4.1 running', 'color:#40a02b;font-weight:bold');
})();
