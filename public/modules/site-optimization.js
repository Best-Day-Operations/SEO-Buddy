'use strict';

(function exposeSiteOptimization(global) {
  const { authFetch, showToast, uiEsc } = global.SeoBuddyCore;
  const citEsc = uiEsc;
  const alert = message => showToast(message);

  // --- ON-SITE & TECHNICAL SEO ---
  async function osPost(body, btn) {
    const orig = btn.innerText;
    btn.disabled = true; btn.innerText = 'Working…';
    try {
      const res = await authFetch('/api/onsite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await res.json();
      if (!res.ok || !d.success) throw new Error(d.error || 'Request failed');
      if (d.unavailable) { alert(d.message); return null; }
      return d.data;
    } catch (e) { alert('Error: ' + e.message); return null; }
    finally { btn.disabled = false; btn.innerText = orig; }
  }

  // --- ON-SITE SEO AUTOPILOT ---
  const oaToggle = document.getElementById('oa-toggle');
  const oaMeta = document.getElementById('oa-meta');
  const oaIdeasBadge = document.getElementById('oa-ideas-badge');
  const oaIdeasBody = document.getElementById('oa-ideas-body');
  const oaLinksBadge = document.getElementById('oa-links-badge');
  const oaLinksBody = document.getElementById('oa-links-body');
  const oaTmBadge = document.getElementById('oa-tm-badge');
  const oaTmBody = document.getElementById('oa-tm-body');
  const oaRun = document.getElementById('oa-run');
  const oaRunNote = document.getElementById('oa-run-note');
  let oaPollTimer = null;

  function oaAgo(iso) {
    if (!iso) return 'never';
    const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    const h = Math.round(mins / 60);
    if (h < 24) return h + 'h ago';
    return Math.round(h / 24) + 'd ago';
  }
  function oaDue(iso, days) {
    if (!iso) return 'due now';
    const rem = (days || 7) - ((Date.now() - new Date(iso).getTime()) / 86400000);
    return rem <= 0 ? 'due now' : ('in ' + Math.ceil(rem) + 'd');
  }

  function oaRenderIdeas(ideas) {
    if (!oaIdeasBody) return;
    if (!ideas || !ideas.clusters || !ideas.clusters.length) { oaIdeasBadge.innerHTML = ''; oaIdeasBody.innerHTML = '<span class="os-empty">No ideas yet — turn on the autopilot or click Run now.</span>'; return; }
    oaIdeasBadge.innerHTML = ideas.isNew ? '<span class="oa-badge">NEW</span>' : '';
    oaIdeasBody.innerHTML = ideas.clusters.slice(0, 4).map(c => `<div class="oa-clu"><b>${citEsc(c.theme || 'Idea')}</b><div class="oa-kw">${(c.keywords || []).slice(0, 4).map(citEsc).join(' · ')}</div>${c.contentIdea ? `<div class="oa-idea">✍ ${citEsc(c.contentIdea)}</div>` : ''}</div>`).join('')
      + `<div class="oa-idea" style="margin-top:6px;">Theme: ${citEsc(ideas.seed || '')} · ${oaAgo(ideas.generatedAt)}</div>`;
  }
  function oaRenderLinks(links) {
    if (!oaLinksBody) return;
    if (!links) { oaLinksBadge.innerHTML = ''; oaLinksBody.innerHTML = '<span class="os-empty">No suggestions yet.</span>'; return; }
    oaLinksBadge.innerHTML = links.isNew ? '<span class="oa-badge">NEW</span>' : '';
    const sug = links.suggestions || [];
    if (!sug.length) { oaLinksBody.innerHTML = `<span class="os-empty">${citEsc(links.note || 'No suggestions yet.')}</span>`; return; }
    oaLinksBody.innerHTML = sug.slice(0, 6).map(s => `<div class="oa-link"><b>${citEsc(s.from)}</b> &rarr; <span style="color:var(--color-secondary)">&ldquo;${citEsc(s.anchor)}&rdquo;</span> &rarr; <b>${citEsc(s.to)}</b><br><span class="text-muted">${citEsc(s.why)}</span></div>`).join('');
  }
  function oaRenderTm(tm) {
    if (!oaTmBody) return;
    if (!tm) { oaTmBadge.innerHTML = ''; oaTmBody.innerHTML = '<span class="os-empty">No suggestions yet.</span>'; return; }
    oaTmBadge.innerHTML = tm.isNew ? '<span class="oa-badge">NEW</span>' : '';
    const row = (t, limit, type, index) => `<div class="oa-opt"><span>${citEsc(t)}</span><span style="white-space:nowrap;"><span class="oa-count ${t.length > limit ? 'over' : ''}">${t.length}/${limit}</span> <button class="oa-cp" type="button" data-copy-type="${type}" data-copy-index="${index}">copy</button></span></div>`;
    oaTmBody.innerHTML = `<div class="text-muted" style="font-size:var(--font-xs);margin-bottom:6px;">For: ${citEsc(tm.page || tm.keyword || '')}</div>`
      + `<div class="os-sub">Titles</div>` + (tm.titles || []).map((t, index) => row(t, 60, 'titles', index)).join('')
      + `<div class="os-sub" style="margin-top:8px;">Meta descriptions</div>` + (tm.metas || []).map((m, index) => row(m, 155, 'metas', index)).join('')
      + `<div class="oa-idea" style="margin-top:6px;">${oaAgo(tm.generatedAt)}</div>`;
    oaTmBody.querySelectorAll('.oa-cp').forEach(button => button.addEventListener('click', () => {
      const values = button.dataset.copyType === 'titles' ? tm.titles : tm.metas;
      const value = (values || [])[Number(button.dataset.copyIndex)];
      if (value == null) return;
      navigator.clipboard.writeText(value);
      button.innerText = '✓';
      setTimeout(() => { button.innerText = 'copy'; }, 1200);
    }));
  }

  function oaRender(s) {
    if (!s) return;
    if (oaToggle) oaToggle.checked = !!s.enabled;
    if (oaMeta) oaMeta.innerHTML = s.hasKey
      ? `Autopilot is <b style="color:${s.enabled ? 'var(--color-success)' : 'var(--text-muted)'}">${s.enabled ? 'ON' : 'OFF'}</b> · next run ${oaDue(s.lastRun, s.intervalDays)}`
      : `<span style="color:var(--color-accent)">Add your Gemini key in Settings to turn the autopilot on.</span>`;
    oaRenderIdeas(s.ideas);
    oaRenderLinks(s.links);
    oaRenderTm(s.titlemeta);
    if ((s.ideas && s.ideas.isNew) || (s.links && s.links.isNew) || (s.titlemeta && s.titlemeta.isNew)) {
      authFetch('/api/onsite-autopilot/seen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
    }
  }

  async function loadOnsiteAutopilot() {
    try {
      const res = await fetch('/api/onsite-autopilot');
      const s = await res.json();
      oaRender(s);
      if (s.busy) oaPoll();
    } catch (e) { /* keep last render */ }
  }
  window.loadOnsiteAutopilot = loadOnsiteAutopilot;

  function oaPoll() {
    if (oaPollTimer) return;
    let n = 0;
    if (oaRun) { oaRun.disabled = true; oaRun.innerText = 'Working… (~1–2 min)'; }
    oaPollTimer = setInterval(async () => {
      n++;
      try {
        const res = await fetch('/api/onsite-autopilot');
        const s = await res.json();
        oaRender(s);
        if (!s.busy || n > 16) { clearInterval(oaPollTimer); oaPollTimer = null; if (oaRun) { oaRun.disabled = false; oaRun.innerText = 'Run now'; } if (oaRunNote) oaRunNote.innerText = ''; }
      } catch (e) { clearInterval(oaPollTimer); oaPollTimer = null; if (oaRun) { oaRun.disabled = false; oaRun.innerText = 'Run now'; } }
    }, 8000);
  }

  if (oaToggle) {
    oaToggle.addEventListener('change', async () => {
      try { await authFetch('/api/onsite-autopilot/toggle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: oaToggle.checked }) }); loadOnsiteAutopilot(); }
      catch (e) { alert('Could not update: ' + e.message); }
    });
  }
  if (oaRun) {
    oaRun.addEventListener('click', async () => {
      oaRun.disabled = true; oaRun.innerText = 'Starting…';
      try {
        const res = await authFetch('/api/onsite-autopilot/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const d = await res.json();
        if (d.unavailable) { alert(d.message); oaRun.disabled = false; oaRun.innerText = 'Run now'; return; }
        if (oaRunNote) oaRunNote.innerText = 'Generating ideas, links and title/meta…';
        setTimeout(oaPoll, 1500);
      } catch (e) { alert('Run error: ' + e.message); oaRun.disabled = false; oaRun.innerText = 'Run now'; }
    });
  }

  // Keyword & topic ideas
  const btnOsKeywords = document.getElementById('btn-os-keywords');
  if (btnOsKeywords) btnOsKeywords.addEventListener('click', async () => {
    const seed = (document.getElementById('os-seed').value || '').trim();
    if (!seed) { alert('Enter a seed keyword.'); return; }
    const out = document.getElementById('os-keywords-out');
    out.innerHTML = '<div class="os-empty">Searching and building topic clusters…</div>';
    const data = await osPost({ tool: 'keywords', seed }, btnOsKeywords);
    if (!data || !data.clusters || !data.clusters.length) { out.innerHTML = '<div class="os-empty">No ideas came back — try a different seed keyword.</div>'; return; }
    out.innerHTML = data.clusters.map(c => `<div class="os-cluster">
      <h4>${citEsc(c.theme || 'Cluster')}</h4>
      <div class="os-chips">${(c.keywords || []).map(k => `<span class="os-chip">${citEsc(k)}</span>`).join('')}</div>
      ${(c.questions || []).map(q => `<div class="os-q">• ${citEsc(q)}</div>`).join('')}
      ${c.contentIdea ? `<div class="os-idea"><b>Content idea:</b> ${citEsc(c.contentIdea)}</div>` : ''}
    </div>`).join('');
  });

  // Will AI quote this page? — score a real page against the course's AEO checklist
  const btnOsAeo = document.getElementById('btn-os-aeo');
  if (btnOsAeo) btnOsAeo.addEventListener('click', async () => {
    const url = (document.getElementById('os-aeo-url').value || '').trim();
    if (!url) { alert('Enter a page URL to check.'); return; }
    const out = document.getElementById('os-aeo-out');
    out.innerHTML = '<div class="os-empty">Fetching the page and scoring it against the AEO checklist… (~10–20s)</div>';
    const data = await osPost({ tool: 'aeoReadiness', url }, btnOsAeo);
    if (!data) { out.innerHTML = ''; return; }
    if (data.fetchError) { out.innerHTML = `<div class="os-empty">${citEsc(data.fetchError)}</div>`; return; }
    const score = Math.max(0, Math.min(100, Math.round(Number(data.overallScore) || 0)));
    const bucket = data.bucket || '';
    const bl = bucket.toLowerCase();
    const scoreColor = score >= 75 ? 'var(--color-success)' : score >= 45 ? 'var(--color-warning)' : 'var(--color-accent)';
    const bucketStyle = bl.includes('ready') ? 'background:rgba(16,185,129,.15);color:var(--color-success);'
      : bl.includes('quick') ? 'background:rgba(245,158,11,.15);color:var(--color-warning);'
      : 'background:rgba(244,63,94,.15);color:var(--color-accent);';
    const checks = (data.checklist || []).map(c => `<div class="aeo-check ${c.pass ? 'ok' : 'no'}"><span class="ic">${c.pass ? '✓' : '✗'}</span><span><span class="lbl">${citEsc(c.label || c.key || '')}</span>${c.note ? ` — <span class="nt">${citEsc(c.note)}</span>` : ''}</span></div>`).join('');
    const fixes = (data.topFixes || []).filter(Boolean);
    out.innerHTML = `<div class="aeo-result">
      <div class="aeo-head">
        <div class="aeo-score" style="color:${scoreColor}">${score}<span style="font-size:1rem;color:var(--text-muted);font-weight:600;">/100</span></div>
        ${bucket ? `<span class="aeo-bucket" style="${bucketStyle}">${citEsc(bucket)}</span>` : ''}
        <div class="text-muted" style="font-size:var(--font-xs);flex:1;min-width:160px;word-break:break-word;">${citEsc(data.pageTitle || data.url || '')}</div>
      </div>
      ${checks}
      ${fixes.length ? `<div class="aeo-fixes"><b>Top fixes:</b><ul style="margin:6px 0 0;padding-left:18px;">${fixes.map(f => `<li style="margin:4px 0;">${citEsc(f)}</li>`).join('')}</ul></div>` : ''}
    </div>`;
  });

  // Title & meta optimizer
  let osTM = { titles: [], metas: [] };
  const osTMOut = document.getElementById('os-titlemeta-out');
  const btnOsTM = document.getElementById('btn-os-titlemeta');
  if (btnOsTM) btnOsTM.addEventListener('click', async () => {
    const keyword = (document.getElementById('os-kw').value || '').trim();
    if (!keyword) { alert('Enter a target keyword.'); return; }
    const currentTitle = (document.getElementById('os-title').value || '').trim();
    osTMOut.innerHTML = '<div class="os-empty">Writing optimized options…</div>';
    const data = await osPost({ tool: 'titlemeta', keyword, currentTitle }, btnOsTM);
    if (!data) { osTMOut.innerHTML = ''; return; }
    osTM = { titles: data.titles || [], metas: data.metas || [] };
    const row = (text, limit, type, i) => `<div class="os-opt"><span>${citEsc(text)}</span><span style="display:flex;gap:8px;align-items:center;"><span class="os-count ${text.length > limit ? 'over' : ''}">${text.length}/${limit}</span><button class="os-copybtn" data-t="${type}" data-i="${i}">copy</button></span></div>`;
    osTMOut.innerHTML = `<div class="os-sub">Title tags</div>` + osTM.titles.map((t, i) => row(t, 60, 'titles', i)).join('') +
      `<div class="os-sub" style="margin-top:12px;">Meta descriptions</div>` + osTM.metas.map((m, i) => row(m, 155, 'metas', i)).join('');
  });
  if (osTMOut) osTMOut.addEventListener('click', e => {
    const b = e.target.closest('.os-copybtn'); if (!b) return;
    const v = (osTM[b.dataset.t] || [])[+b.dataset.i]; if (v == null) return;
    navigator.clipboard.writeText(v); b.innerText = '✓'; setTimeout(() => b.innerText = 'copy', 1200);
  });

  // Internal link suggestions
  const btnOsLinks = document.getElementById('btn-os-links');
  if (btnOsLinks) btnOsLinks.addEventListener('click', async () => {
    const out = document.getElementById('os-links-out');
    out.innerHTML = '<div class="os-empty">Reviewing your published pages…</div>';
    const data = await osPost({ tool: 'links' }, btnOsLinks);
    if (!data) { out.innerHTML = ''; return; }
    const sug = data.suggestions || [];
    if (!sug.length) { out.innerHTML = `<div class="os-empty">${citEsc(data.note || 'No suggestions yet.')}</div>`; return; }
    out.innerHTML = sug.map(s => `<div class="os-link"><div><b>${citEsc(s.from)}</b> &rarr; <span class="os-anchor">&ldquo;${citEsc(s.anchor)}&rdquo;</span> &rarr; <b>${citEsc(s.to)}</b></div><div class="os-why">${citEsc(s.why)}</div></div>`).join('');
  });

  // Extended schema pack
  let osSchemas = null;
  const osSchemaOut = document.getElementById('os-schema-out');
  async function osLoadSchema() {
    if (osSchemas) return true;
    try { const res = await fetch('/api/onsite-schema'); osSchemas = await res.json(); return true; }
    catch (e) { alert('Could not load schema: ' + e.message); return false; }
  }
  function osShowSchema(type, btn) {
    osLoadSchema().then(ok => { if (ok && osSchemaOut) osSchemaOut.value = osSchemas[type] || ''; });
  }
  const btnOsFaqpage = document.getElementById('btn-os-faqpage');
  const btnOsArticle = document.getElementById('btn-os-article');
  const btnOsHowto = document.getElementById('btn-os-howto');
  const btnOsService = document.getElementById('btn-os-service');
  const btnOsReview = document.getElementById('btn-os-review');
  const btnOsBreadcrumb = document.getElementById('btn-os-breadcrumb');
  if (btnOsFaqpage) btnOsFaqpage.addEventListener('click', () => osShowSchema('faqpage'));
  if (btnOsArticle) btnOsArticle.addEventListener('click', () => osShowSchema('article'));
  if (btnOsHowto) btnOsHowto.addEventListener('click', () => osShowSchema('howto'));
  if (btnOsService) btnOsService.addEventListener('click', () => osShowSchema('service'));
  if (btnOsReview) btnOsReview.addEventListener('click', () => osShowSchema('review'));
  if (btnOsBreadcrumb) btnOsBreadcrumb.addEventListener('click', () => osShowSchema('breadcrumb'));
  const btnOsSchemaCopy = document.getElementById('btn-os-schema-copy');
  if (btnOsSchemaCopy) btnOsSchemaCopy.addEventListener('click', () => {
    if (!osSchemaOut.value) { alert('Pick a schema type first.'); return; }
    navigator.clipboard.writeText(osSchemaOut.value);
    btnOsSchemaCopy.innerText = 'Copied!'; setTimeout(() => btnOsSchemaCopy.innerText = 'Copy', 1500);
  });




  // --- WEBSITE AUDIT & GHL SCHEMA ENGINE ---
  const auditTargetInput = document.getElementById('audit-target-url');
  const btnAuditPreview = document.getElementById('btn-audit-preset-preview');
  const btnAuditProd = document.getElementById('btn-audit-preset-prod');
  const btnRunAudit = document.getElementById('btn-run-website-audit');
  const auditResultsContainer = document.getElementById('website-audit-results');
  const ghlBadgesContainer = document.getElementById('ghl-schema-validation-badges');
  const ghlSnippetOutput = document.getElementById('ghl-snippet-output');
  const btnCopyGhlSnippet = document.getElementById('btn-copy-ghl-snippet');

  if (btnAuditPreview && auditTargetInput) {
    btnAuditPreview.addEventListener('click', () => {
      auditTargetInput.value = 'https://link.bestdayfitness.com/preview/VRsgFMkoL8fUwW9W4ckU?v_test=1790778792385#home';
    });
  }

  if (btnAuditProd && auditTargetInput) {
    btnAuditProd.addEventListener('click', () => {
      auditTargetInput.value = 'https://bestdayfitness.com';
    });
  }

  if (btnCopyGhlSnippet && ghlSnippetOutput) {
    btnCopyGhlSnippet.addEventListener('click', () => {
      if (!ghlSnippetOutput.value) return;
      navigator.clipboard.writeText(ghlSnippetOutput.value);
      btnCopyGhlSnippet.innerText = 'Copied!';
      setTimeout(() => { btnCopyGhlSnippet.innerText = 'Copy Tracking Code'; }, 1500);
    });
  }

  function renderAuditResults(data) {
    if (!auditResultsContainer) return;
    if (!data) {
      auditResultsContainer.innerHTML = '<div class="os-empty">No audit results yet. Click Run Audit.</div>';
      return;
    }

    const checks = data.checks || {};
    const crawl = checks.crawlability || {};
    const meta = checks.metadata || {};
    const schema = checks.structuredData || {};
    const perf = checks.performance || {};
    const geo = checks.geoOptimizer || {};
    const recs = data.recommendations || [];

    // Crawl status badge
    let crawlBadge = '';
    const isAuditUnavailable = data.status === 'unavailable' || crawl.status === 'unavailable';

    if (isAuditUnavailable) {
      crawlBadge = '<span class="badge" style="background:rgba(245,158,11,0.15);color:var(--color-warning);padding:2px 8px;border-radius:4px;">Audit Unavailable (Fetch Failed)</span>';
    } else if (crawl.status === 'PROTECTED_STAGING') {
      crawlBadge = '<span class="badge" style="background:rgba(16,185,129,0.15);color:var(--color-success);padding:2px 8px;border-radius:4px;">Protected Staging (noindex active)</span>';
    } else if (crawl.status === 'EXPOSED_STAGING_WARNING') {
      crawlBadge = '<span class="badge" style="background:rgba(239,68,68,0.15);color:var(--color-accent);padding:2px 8px;border-radius:4px;">Warning: Staging Missing noindex</span>';
    } else if (crawl.status === 'PRODUCTION_INDEXABLE') {
      crawlBadge = '<span class="badge" style="background:rgba(16,185,129,0.15);color:var(--color-success);padding:2px 8px;border-radius:4px;">Production Indexable</span>';
    } else {
      crawlBadge = '<span class="badge" style="background:rgba(239,68,68,0.15);color:var(--color-accent);padding:2px 8px;border-radius:4px;">Production Noindex Warning</span>';
    }

    // GEO status badge
    let geoBadge = '';
    let geoScoreText = '';
    if (geo.status === 'completed') {
      geoBadge = '<span class="badge" style="background:rgba(16,185,129,0.15);color:var(--color-success);padding:2px 8px;border-radius:4px;">GEO Optimizer: Completed</span>';
      geoScoreText = '<b>' + citEsc(String(geo.score)) + '/100</b> (band: ' + citEsc(geo.band || 'evaluated') + ')';
    } else if (geo.status === 'unavailable') {
      geoBadge = '<span class="badge" style="background:rgba(245,158,11,0.15);color:var(--color-warning);padding:2px 8px;border-radius:4px;">GEO Optimizer: Unavailable (Score: None)</span>';
      geoScoreText = '<span class="text-muted">' + citEsc(geo.error || 'Blocked or oversized') + '</span>';
    } else if (geo.status === 'evidence_target_mismatch') {
      geoBadge = '<span class="badge" style="background:rgba(239,68,68,0.15);color:var(--color-accent);padding:2px 8px;border-radius:4px;">GEO Optimizer: Evidence Mismatch (Score: None)</span>';
      geoScoreText = '<span class="text-muted">' + citEsc(geo.error || 'Evidence target does not match audit URL') + '</span>';
    } else {
      geoBadge = '<span class="badge" style="background:rgba(107,114,128,0.15);color:var(--text-muted);padding:2px 8px;border-radius:4px;">GEO Optimizer: Not Run (Score: None)</span>';
      geoScoreText = '<span class="text-muted">Not run for this target URL. Fallback scores prohibited.</span>';
    }

    const recsHtml = recs.length ? recs.map(r => {
      const pColor = r.priority === 'CRITICAL' ? 'var(--color-accent)' : r.priority === 'HIGH' ? 'var(--color-warning)' : 'var(--color-primary)';
      return '<div style="border-left:3px solid ' + pColor + ';padding:8px 12px;margin-bottom:8px;background:rgba(0,0,0,0.02);border-radius:0 4px 4px 0;">' +
        '<div style="display:flex;gap:8px;align-items:center;">' +
          '<span style="font-size:0.7rem;font-weight:700;color:' + pColor + ';text-transform:uppercase;">' + citEsc(r.priority) + ' &bull; ' + citEsc(r.area) + '</span>' +
        '</div>' +
        '<div style="font-weight:600;margin:2px 0;">' + citEsc(r.action) + '</div>' +
        '<div style="font-size:var(--font-xs);color:var(--text-muted);">' + citEsc(r.evidence) + '</div>' +
        '<div style="font-size:var(--font-xs);margin-top:2px;"><em>' + citEsc(r.reason) + '</em></div>' +
      '</div>';
    }).join('') : '<div class="text-muted" style="font-size:var(--font-xs);">No high-priority recommendations at this time.</div>';

    const titleHtml = isAuditUnavailable
      ? '<span class="text-muted">Unavailable (fetch failed)</span>'
      : (meta.hasTitle ? '<span style="color:var(--color-success)">✓ (' + meta.titleLength + ' chars)</span>' : '<span style="color:var(--color-accent)">✗ MISSING</span>');
    const descHtml = isAuditUnavailable
      ? '<span class="text-muted">Unavailable (fetch failed)</span>'
      : (meta.hasDescription ? '<span style="color:var(--color-success)">✓ (' + meta.descriptionLength + ' chars)</span>' : '<span style="color:var(--color-accent)">✗ MISSING</span>');
    const canonHtml = isAuditUnavailable
      ? '<span class="text-muted">Unavailable (fetch failed)</span>'
      : (meta.hasCanonical ? citEsc(meta.canonicalUrl) : 'None declared');
    const schemaBlocksHtml = isAuditUnavailable
      ? '<span class="text-muted">Unavailable</span>'
      : '<b>' + (schema.blockCount || 0) + '</b> (' + (schema.entityCount || 0) + ' entities)';
    const hoursHtml = isAuditUnavailable
      ? '<span class="text-muted">Unavailable</span>'
      : (schema.hoursCompliant ? '<span style="color:var(--color-success)">✓ 7 Days Compliant</span>' : '<span style="color:var(--color-accent)">✗ Non-compliant/Missing</span>');
    const payloadHtml = isAuditUnavailable
      ? '<span class="text-muted">Unavailable</span>'
      : '<b>' + (perf.sizeMegabytes || '0.00') + ' MB</b>';

    auditResultsContainer.innerHTML = [
      '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;padding-bottom:12px;border-bottom:1px solid var(--border-color);margin-bottom:12px;">',
        '<div><strong>Target:</strong> <span style="font-family:monospace;font-size:var(--font-xs);">' + citEsc(data.targetUrl || checks.url || '') + '</span></div>',
        '<div style="display:flex;gap:8px;align-items:center;">' + crawlBadge + geoBadge + '</div>',
      '</div>',
      '<div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:12px;margin-bottom:16px;">',
        '<div style="background:var(--bg-card);border:1px solid var(--border-color);border-radius:6px;padding:10px;">',
          '<div style="font-size:var(--font-xs);font-weight:600;color:var(--text-muted);">Crawlability &amp; Robots</div>',
          '<div style="font-size:var(--font-sm);margin-top:4px;">' + citEsc(crawl.observedRobots || (isAuditUnavailable ? 'Unavailable (fetch failed)' : 'None')) + '</div>',
          '<div style="font-size:var(--font-xs);color:var(--text-muted);margin-top:4px;">' + citEsc(crawl.explanation || (isAuditUnavailable ? (data.error || 'Fetch failed') : '')) + '</div>',
        '</div>',
        '<div style="background:var(--bg-card);border:1px solid var(--border-color);border-radius:6px;padding:10px;">',
          '<div style="font-size:var(--font-xs);font-weight:600;color:var(--text-muted);">Strict Head Metadata</div>',
          '<div style="font-size:var(--font-sm);margin-top:4px;">Title: ' + titleHtml + '</div>',
          '<div style="font-size:var(--font-sm);">Description: ' + descHtml + '</div>',
          '<div style="font-size:var(--font-xs);color:var(--text-muted);margin-top:4px;">Canonical: ' + canonHtml + '</div>',
        '</div>',
        '<div style="background:var(--bg-card);border:1px solid var(--border-color);border-radius:6px;padding:10px;">',
          '<div style="font-size:var(--font-xs);font-weight:600;color:var(--text-muted);">Structured Data &amp; Schema</div>',
          '<div style="font-size:var(--font-sm);margin-top:4px;">Schema blocks: ' + schemaBlocksHtml + '</div>',
          '<div style="font-size:var(--font-xs);margin-top:4px;">Approved hours: ' + hoursHtml + '</div>',
          (schema.malformedCount ? '<div style="font-size:var(--font-xs);color:var(--color-accent);margin-top:2px;">⚠ ' + schema.malformedCount + ' malformed JSON-LD block(s)</div>' : ''),
        '</div>',
        '<div style="background:var(--bg-card);border:1px solid var(--border-color);border-radius:6px;padding:10px;">',
          '<div style="font-size:var(--font-xs);font-weight:600;color:var(--text-muted);">Performance &amp; Asset Bloat</div>',
          '<div style="font-size:var(--font-sm);margin-top:4px;">Payload size: ' + payloadHtml + '</div>',
          '<div style="font-size:var(--font-xs);color:var(--text-muted);margin-top:4px;">Inlined scripts: ' + (isAuditUnavailable ? 'Unavailable' : (perf.scriptCount || 0) + ' &bull; Base64 images: ' + (perf.base64Count || 0)) + '</div>',
          (perf.isOversized ? '<div style="font-size:var(--font-xs);color:var(--color-warning);margin-top:2px;">⚠ Exceeds 10MB parser limit</div>' : ''),
        '</div>',
      '</div>',
      '<div style="background:var(--bg-card);border:1px solid var(--border-color);border-radius:6px;padding:10px;margin-bottom:16px;">',
        '<div style="display:flex;justify-content:space-between;align-items:center;">',
          '<div style="font-size:var(--font-xs);font-weight:600;color:var(--text-muted);">External GEO Optimizer Evidence</div>',
          '<div>' + geoScoreText + '</div>',
        '</div>',
      '</div>',
      '<div>',
        '<h4 style="margin:0 0 8px;">Actionable Audit Recommendations (' + recs.length + ')</h4>',
        recsHtml,
      '</div>'
    ].join('');
  }

  async function loadWebsiteAudit() {
    try {
      const res = await fetch('/api/website-audit');
      const d = await res.json();
      if (d && d.latest) {
        renderAuditResults(d.latest);
      }
    } catch (e) {}
  }

  async function loadGhlSchema() {
    try {
      const res = await fetch('/api/ghl-schema');
      const d = await res.json();
      if (!d || !d.success) return;

      if (ghlSnippetOutput) {
        ghlSnippetOutput.value = d.snippet || '';
      }

      if (ghlBadgesContainer && d.validation) {
        const v = d.validation;
        const cats = v.categories || {};

        const badge = (label, pass, detail) => {
          const bg = pass ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)';
          const col = pass ? 'var(--color-success)' : 'var(--color-accent)';
          const icon = pass ? '✓' : '✗';
          return '<div style="background:' + bg + ';color:' + col + ';font-size:0.75rem;padding:4px 10px;border-radius:4px;display:flex;align-items:center;gap:6px;" title="' + citEsc(detail || '') + '">' +
            '<strong>' + icon + ' ' + citEsc(label) + '</strong>' +
          '</div>';
        };

        ghlBadgesContainer.innerHTML = [
          badge('JSON Syntax', cats.jsonSyntax?.pass, cats.jsonSyntax?.issues?.join(', ') || 'Valid Schema.org syntax'),
          badge('Approved Facts (7 Days, NAP, Pricing)', cats.approvedFacts?.pass, cats.approvedFacts?.verifiedFacts?.join('; ') || cats.approvedFacts?.issues?.join('; ')),
          badge('Schema.org Vocabulary', cats.schemaOrgVocabulary?.pass, 'Standard Schema.org types verified'),
          badge('Google Policy (Self-Serving Reviews Excluded)', cats.googleFeatureEligibility?.eligible, cats.googleFeatureEligibility?.warnings?.join('; ') || 'Google structured data compliant'),
        ].join('');
      }
    } catch (e) {}
  }

  if (btnRunAudit) {
    btnRunAudit.addEventListener('click', async () => {
      const url = (auditTargetInput?.value || '').trim();
      if (!url) { alert('Enter a target URL to audit.'); return; }
      const origText = btnRunAudit.innerText;
      btnRunAudit.disabled = true;
      btnRunAudit.innerText = 'Auditing…';
      auditResultsContainer.innerHTML = '<div class="os-empty">Fetching ' + citEsc(url) + ' and running audit engine… (~5–10s)</div>';

      try {
        const res = await authFetch('/api/website-audit/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        });
        const d = await res.json();
        if (d && d.snapshot) {
          renderAuditResults(d.snapshot);
        } else if (d && d.error) {
          alert('Audit error: ' + d.error);
          renderAuditResults(d.snapshot);
        }
      } catch (err) {
        alert('Audit failed: ' + err.message);
      } finally {
        btnRunAudit.disabled = false;
        btnRunAudit.innerText = origText;
      }
    });
  }

  // Load audit and schema data on page initialization
  loadWebsiteAudit();
  loadGhlSchema();

  })(window);
