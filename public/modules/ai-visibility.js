'use strict';

(function exposeAiVisibility(global) {
  const { authFetch, safeExternalUrl, sanitizeHtml, showToast, uiEsc } = global.SeoBuddyCore;
  function alert(message) { showToast(message); }

  // AIO / GEO selectors and state are private to this on-demand workspace.
  const aioQuerySelector = document.getElementById('aio-query-selector');
  const aioCustomQueryContainer = document.getElementById('aio-custom-query-container');
  const aioCustomQuery = document.getElementById('aio-custom-query');
  const btnRunAioAudit = document.getElementById('btn-run-aio-audit');
  const aioResultsPanel = document.getElementById('aio-results-panel');
  const aioStatusBadge = document.getElementById('aio-status-badge');
  const aioSovRate = document.getElementById('aio-sov-rate');
  const aioSnippetText = document.getElementById('aio-snippet-text');
  const aioCitedUrls = document.getElementById('aio-cited-urls');
  const aioCompetitors = document.getElementById('aio-competitors');
  const aioSearchQueries = document.getElementById('aio-search-queries');
  const aioSearchSuggestions = document.getElementById('aio-search-suggestions');
  const btnSchemaLocal = document.getElementById('btn-schema-local');
  const btnSchemaFaq = document.getElementById('btn-schema-faq');
  const btnCopySchema = document.getElementById('btn-copy-schema');
  const schemaCodeOutput = document.getElementById('schema-code-output');
  const aioHistoryTableBody = document.getElementById('aio-history-table-body');
  let compiledSchemas = { localBusiness: '', faq: '' };
  let activeSchemaType = 'localBusiness';

  // --- AI SEARCH AUDIT & SCHEMA ASSET ENGINE ---
  aioQuerySelector.addEventListener('change', () => {
    if (aioQuerySelector.value === 'custom') {
      aioCustomQueryContainer.style.display = 'block';
    } else {
      aioCustomQueryContainer.style.display = 'none';
    }
  });

  async function fetchAioHistory() {
    try {
      const res = await fetch('/api/aio-history');
      const history = await res.json();
      renderAioHistory(history);

      if (history.length > 0) {
        const citedCount = history.filter(item => item.recommended).length;
        const rate = Math.round((citedCount / history.length) * 100);
        aioSovRate.innerText = `${rate}%`;
      }
    } catch (err) {
      console.error('[AIO History] Sync failed:', err.message);
    }
  }

  function renderAioHistory(history) {
    aioHistoryTableBody.innerHTML = '';

    if (history.length === 0) {
      aioHistoryTableBody.innerHTML = `<tr><td colspan="5" class="text-center text-muted" style="padding: 16px;">No historical audits found. Click audit button to start!</td></tr>`;
      return;
    }

    history.forEach(item => {
      const tr = document.createElement('tr');
      const date = new Date(item.timestamp).toLocaleString();

      const statusText = item.recommended ? 'Recommended' : 'Not Mentioned';
      const statusClass = item.recommended ? 'clean' : 'leak';

      // "Cited as Source?" reflects whether the brand appeared in the REAL cited
      // sources (item.cited); older records without the flag fall back to recommended.
      const citedFlag = (typeof item.cited === 'boolean') ? item.cited : item.recommended;
      const citedText = citedFlag ? 'Yes' : 'No';
      const competitorsStr = item.competitors && item.competitors.length > 0 ? item.competitors.join(', ') : 'None';

      tr.innerHTML = `
        <td>${uiEsc(date)}</td>
        <td><span class="keyword-tag">${uiEsc(item.query)}</span></td>
        <td><span class="status-badge ${statusClass}">${statusText}</span></td>
        <td class="font-medium">${citedText}</td>
        <td>${uiEsc(competitorsStr)}</td>
      `;
      aioHistoryTableBody.appendChild(tr);
    });
  }

  async function fetchAioSchemas() {
    try {
      const res = await fetch('/api/aio-schema');
      const data = await res.json();
      compiledSchemas = data;
      renderSchemaOutput();
    } catch (err) {
      console.error('[AIO Schemas] Build failed:', err.message);
    }
  }

  function renderSchemaOutput() {
    const code = compiledSchemas[activeSchemaType] || '// Failed to load schema';
    schemaCodeOutput.value = code;
  }

  btnSchemaLocal.addEventListener('click', () => {
    btnSchemaLocal.classList.add('active');
    btnSchemaFaq.classList.remove('active');
    activeSchemaType = 'localBusiness';
    renderSchemaOutput();
  });

  btnSchemaFaq.addEventListener('click', () => {
    btnSchemaFaq.classList.add('active');
    btnSchemaLocal.classList.remove('active');
    activeSchemaType = 'faq';
    renderSchemaOutput();
  });

  btnCopySchema.addEventListener('click', () => {
    navigator.clipboard.writeText(schemaCodeOutput.value);
    btnCopySchema.innerText = 'Copied!';
    setTimeout(() => {
      btnCopySchema.innerText = 'Copy code';
    }, 2000);
  });

  btnRunAioAudit.addEventListener('click', async () => {
    let query = aioQuerySelector.value;
    if (query === 'custom') {
      query = aioCustomQuery.value.trim();
    }

    if (!query) {
      alert('Please select or input a search query to audit.');
      return;
    }

    btnRunAioAudit.disabled = true;
    btnRunAioAudit.innerText = 'Querying Google\'s AI (live search)…';
    aioResultsPanel.style.display = 'none';

    try {
      const res = await authFetch('/api/aio-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query })
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'AIO Audit API failed');
      }

      // Honest "no Gemini key" state — never render fabricated results.
      if (data.unavailable) {
        alert(data.message || 'Add your Gemini key in Settings to run a real check.');
        renderAioHistory(data.history || []);
        return;
      }

      const latest = data.latest;

      aioResultsPanel.style.display = 'block';

      const badgeText = aioStatusBadge.querySelector('.status-text');
      if (latest.recommended) {
        aioStatusBadge.className = 'status-indicator live';
        badgeText.innerText = latest.cited ? 'Recommended + Cited' : 'Mentioned';
      } else {
        aioStatusBadge.className = 'status-indicator mock';
        badgeText.innerText = 'Not Mentioned';
      }

      aioSnippetText.innerText = latest.responseSnippet || '(no answer text returned)';

      // Cited sources — real domains from Google's grounding (title = domain, uri = link).
      aioCitedUrls.innerHTML = '';
      const sources = (latest.citedSources && latest.citedSources.length)
        ? latest.citedSources
        : (latest.citedUrls || []).map(u => ({ title: u.replace(/^https?:\/\//, ''), uri: u }));
      if (!sources.length) {
        aioCitedUrls.innerHTML = `<li style="color: var(--text-muted); padding: 4px 0;">None</li>`;
      } else {
        sources.forEach(s => {
          const li = document.createElement('li');
          li.style.marginBottom = '6px';
          const label = s.title || (s.uri || '').replace(/^https?:\/\//, '');
          if (s.uri) {
            li.innerHTML = `<a href="${uiEsc(safeExternalUrl(s.uri))}" target="_blank" rel="noopener noreferrer" class="live-link" style="text-decoration: underline;">${uiEsc(label)}</a>`;
          } else {
            li.innerText = label;
          }
          aioCitedUrls.appendChild(li);
        });
      }

      aioCompetitors.innerHTML = '';
      if (!latest.competitors || latest.competitors.length === 0) {
        aioCompetitors.innerHTML = `<li style="color: var(--text-muted); padding: 4px 0;">None</li>`;
      } else {
        latest.competitors.forEach(comp => {
          const li = document.createElement('li');
          li.style.color = 'var(--text-muted)';
          li.style.marginBottom = '6px';
          li.innerText = comp;
          aioCompetitors.appendChild(li);
        });
      }

      // Real Google Search queries used for grounding.
      if (aioSearchQueries) {
        if (latest.searchQueries && latest.searchQueries.length) {
          aioSearchQueries.style.display = 'block';
          aioSearchQueries.innerHTML = `<strong style="color: var(--text-muted);">Google searches run:</strong> ${latest.searchQueries.map(q => `<span class="keyword-tag">${uiEsc(q)}</span>`).join(' ')}`;
        } else {
          aioSearchQueries.style.display = 'none';
          aioSearchQueries.innerHTML = '';
        }
      }

      // Google-required Search Suggestions chip (from grounding metadata).
      if (aioSearchSuggestions) {
        if (latest.searchEntryPoint) {
          aioSearchSuggestions.style.display = 'block';
          aioSearchSuggestions.innerHTML = sanitizeHtml(latest.searchEntryPoint);
        } else {
          aioSearchSuggestions.style.display = 'none';
          aioSearchSuggestions.innerHTML = '';
        }
      }

      renderAioHistory(data.history);
      if (data.history.length > 0) {
        const citedCount = data.history.filter(item => item.recommended).length;
        const rate = Math.round((citedCount / data.history.length) * 100);
        aioSovRate.innerText = `${rate}%`;
      }

    } catch (err) {
      alert(`AIO Audit Error: ${err.message}`);
    } finally {
      btnRunAioAudit.disabled = false;
      btnRunAioAudit.innerText = 'Run Live Google-AI Audit';
    }
  });

  // --- MULTI-ENGINE AI VISIBILITY DASHBOARD (Phase 1/2) ---
  let avState = null;
  let avMetric = 'visibility';
  const AV_METRIC_META = {
    visibility: { label: 'Search Visibility Score', desc: 'Percentage of search-grounded AI answers that recommend your brand. Requires verified search evidence.' },
    shareOfVoice: { label: 'How often you are named', desc: 'Your share of all brand mentions vs competitors in AI answers.' },
    sentiment: { label: 'Sentiment', desc: 'How positively AI describes you when it mentions you (100 = all positive).' }
  };
  const avEl = id => document.getElementById(id);
  function avEsc(s) { const d = document.createElement('div'); d.innerText = s == null ? '' : String(s); return d.innerHTML; }

  function avMetricValue(snap, metric) {
    if (!snap) return null;
    if (metric === 'visibility') return snap.visibilityScore;
    if (metric === 'shareOfVoice') return snap.shareOfVoice;
    if (metric === 'sentiment') return snap.sentimentScore;
    return null;
  }
  function avDeltaVal(metric) {
    if (!avState || !avState.deltas) return null;
    return avState.deltas[metric];
  }

  function avRenderEngines() {
    const wrap = avEl('av-engines'); if (!wrap) return;
    wrap.innerHTML = (avState.engines || []).map(e =>
      `<span class="av-chip ${e.configured ? 'on' : 'off'}" title="${e.configured ? 'Connected' : 'Add ' + avEsc(e.id.toUpperCase()) + '_API_KEY in Railway to enable'}"><span class="dot"></span>${avEsc(e.label)}${e.configured ? '' : ' &middot; off'}</span>`
    ).join('');
  }

  // Simple responsive SVG multi-line chart. series=[{name,isBrand,color,points:[{date,score}]}]
  function avLineChart(series, dates) {
    const W = 640, H = 220, padL = 30, padR = 12, padT = 12, padB = 22;
    const n = dates.length;
    const maxY = 100;
    const x = i => padL + (n <= 1 ? (W - padL - padR) / 2 : (i * (W - padL - padR) / (n - 1)));
    const y = v => padT + (H - padT - padB) * (1 - (Math.max(0, Math.min(maxY, v)) / maxY));
    let g = '';
    // horizontal gridlines at 0/25/50/75/100
    for (const gv of [0, 25, 50, 75, 100]) {
      g += `<line x1="${padL}" y1="${y(gv)}" x2="${W - padR}" y2="${y(gv)}" stroke="var(--chart-grid)" stroke-width="1"/>`;
      g += `<text x="${padL - 6}" y="${y(gv) + 3}" text-anchor="end" font-size="9" fill="var(--text-muted)">${gv}</text>`;
    }
    series.forEach(s => {
      const pts = s.points.map((p, i) => `${x(i)},${y(p.score)}`);
      const col = s.color || (s.isBrand ? 'var(--chart-primary)' : 'var(--chart-neutral)');
      if (pts.length > 1) g += `<polyline points="${pts.join(' ')}" fill="none" stroke="${col}" stroke-width="${s.isBrand ? 3 : 1.6}" stroke-linecap="round" stroke-linejoin="round" opacity="${s.isBrand ? 1 : .75}"/>`;
      s.points.forEach((p, i) => { g += `<circle cx="${x(i)}" cy="${y(p.score)}" r="${s.isBrand ? 3.5 : 2.5}" fill="${col}"/>`; });
    });
    // x labels (first + last)
    if (n) {
      g += `<text x="${x(0)}" y="${H - 6}" text-anchor="start" font-size="9" fill="var(--text-muted)">${avEsc(dates[0])}</text>`;
      if (n > 1) g += `<text x="${x(n - 1)}" y="${H - 6}" text-anchor="end" font-size="9" fill="var(--text-muted)">${avEsc(dates[n - 1])}</text>`;
    }
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="AI visibility trend">${g}</svg>`;
  }

  const AV_PALETTE = ['var(--chart-primary)', 'var(--chart-secondary)', 'var(--chart-tertiary)', 'var(--p2-g)', 'var(--p3-g)', 'var(--p5-g)'];
  function avChartWindow(dates) {
    if (!dates.length) return '';
    const range = dates.length === 1 ? dates[0] : `${dates[0]}–${dates[dates.length - 1]}`;
    return `${dates.length} completed check${dates.length === 1 ? '' : 's'} · ${range}`;
  }
  function avRenderChart() {
    const box = avEl('av-chart'), legend = avEl('av-legend'); if (!box) return;
    const trend = avState.trend || { series: [], dates: [], metricLines: {} };
    const dates = trend.dates || [];
    if (!dates.length) { box.innerHTML = '<div class="text-muted" style="font-size:13px;padding:20px 0;">Run a check to start the trend. It builds a line over time as checks accrue.</div>'; legend.innerHTML = ''; return; }
    if (avMetric === 'visibility') {
      // multi-brand: you vs top competitors
      const series = (trend.series || []).map((s, i) => ({ ...s, color: s.isBrand ? AV_PALETTE[0] : AV_PALETTE[(i % (AV_PALETTE.length - 1)) + 1] }));
      box.innerHTML = avLineChart(series, dates);
      legend.innerHTML = `<span class="ws-chart-series">${series.map(s => `<span class="lg"><i style="--legend-color:${s.color}"></i>${avEsc(s.name)}${s.isBrand ? ' (you)' : ''}</span>`).join('')}</span><strong>${avEsc(avChartWindow(dates))}</strong>`;
    } else {
      const line = (trend.metricLines && trend.metricLines[avMetric]) || [];
      const series = [{ name: avState.brand, isBrand: true, color: AV_PALETTE[0], points: line.map(p => ({ date: p.date, score: p.value == null ? 0 : p.value })) }];
      box.innerHTML = avLineChart(series, dates);
      legend.innerHTML = `<span class="ws-chart-series"><span class="lg"><i style="--legend-color:${AV_PALETTE[0]}"></i>${avEsc(AV_METRIC_META[avMetric].label)}</span></span><strong>${avEsc(avChartWindow(dates))}</strong>`;
    }
  }

  function avRenderScore() {
    const snap = avState.latest;
    const val = avMetricValue(snap, avMetric);
    if (avMetric === 'visibility') {
      if (val != null) {
        avEl('av-score').innerHTML = `${val}%`;
      } else if (snap && snap.modelOnlyVisibilityScore != null) {
        avEl('av-score').innerHTML = `<span style="font-size:0.65em;display:block;color:var(--text-muted);">Model-only: ${snap.modelOnlyVisibilityScore}%</span><span style="font-size:0.45em;display:block;color:var(--warn-color,#e65100);">Search Unavailable</span>`;
      } else {
        avEl('av-score').innerHTML = '&mdash;';
      }
    } else {
      avEl('av-score').innerHTML = (val == null ? '&mdash;' : val + (avMetric === 'sentiment' ? '' : '%'));
    }
    avEl('av-metric-desc').innerText = AV_METRIC_META[avMetric].desc;
    const d = avDeltaVal(avMetric);
    const dEl = avEl('av-delta');
    if (d == null || !snap) { dEl.style.display = 'none'; }
    else {
      dEl.style.display = '';
      const cls = d > 0 ? 'up' : d < 0 ? 'down' : 'flat';
      dEl.className = 'av-delta ' + cls;
      dEl.innerText = (d > 0 ? '▲ +' : d < 0 ? '▼ ' : '± ') + d + (avMetric === 'sentiment' ? '' : '%');
    }
    // metric tab active state
    document.querySelectorAll('#aio-tab .av-mtab').forEach(b => b.classList.toggle('active', b.dataset.metric === avMetric));
  }

  function avRenderEngineBreakdown() {
    const box = avEl('av-eng-break'); if (!box) return;
    const snap = avState.latest;
    if (!snap || !snap.perEngine || !snap.perEngine.length) { box.style.display = 'none'; return; }
    box.style.display = '';
    box.innerHTML = `<div class="av-lb-title">Visibility by engine &middot; latest check</div>` + snap.perEngine.map(pe => {
      const scoreText = pe.score != null ? `${pe.score}%` : (pe.modelScore != null ? `Model-only: ${pe.modelScore}%` : 'Unavailable');
      const widthVal = pe.score != null ? pe.score : (pe.modelScore != null ? pe.modelScore : 0);
      return `<div class="av-eng-row"><span>${avEsc(pe.label || pe.engine)}</span><span class="av-eng-track"><span class="av-eng-fill" style="width:${widthVal}%"></span></span><span style="text-align:right;font-weight:700;font-size:12px;">${avEsc(scoreText)}</span></div>`;
    }).join('');
  }

  function avRenderLeaderboard() {
    const box = avEl('av-leaderboard'); if (!box) return;
    const snap = avState.latest;
    const lb = (snap && snap.leaderboard) || [];
    // build a prev-map for deltas
    const snaps = (avState.trend && avState.trend.series) || [];
    const prevScore = {};
    (avState.trend && avState.trend.dates || []);
    if (!lb.length) { box.innerHTML = '<div class="text-muted" style="font-size:13px;">No brands detected yet — run a check.</div>'; return; }
    box.innerHTML = lb.slice(0, 8).map((row, i) => {
      // delta from the brand's own trend line if available
      let deltaHtml = '<span class="av-lb-delta flat">—</span>';
      const sTrend = (avState.trend.series || []).find(s => s.name.toLowerCase() === row.name.toLowerCase());
      if (sTrend && sTrend.points.length > 1) {
        const dv = sTrend.points[sTrend.points.length - 1].score - sTrend.points[sTrend.points.length - 2].score;
        const cls = dv > 0 ? 'up' : dv < 0 ? 'down' : 'flat';
        deltaHtml = `<span class="av-lb-delta ${cls}">${dv > 0 ? '▲' : dv < 0 ? '▼' : ''}${dv === 0 ? '—' : Math.abs(dv) + '%'}</span>`;
      }
      return `<div class="av-lb-row ${row.isBrand ? 'me' : ''}">
        <span class="av-lb-rank">${i + 1}</span>
        <span class="av-lb-name">${avEsc(row.name)}${row.isBrand ? '<span class="youtag">YOU</span>' : ''}</span>
        <span class="av-lb-score">${row.score}%</span>
        ${deltaHtml}
      </div>`;
    }).join('');
  }

  function avRender() {
    if (!avState) return;
    avRenderEngines();
    const anyConfigured = avState.anyConfigured;
    const hasData = !!avState.latest;
    const emptyEl = avEl('av-empty'), mainEl = avEl('av-main');
    // auto-weekly toggle + running state
    const autoBox = avEl('av-auto'); if (autoBox) autoBox.checked = !!avState.autoEnabled;
    const runBtn = avEl('av-run');
    if (runBtn) {
      if (avState.running) { runBtn.disabled = true; runBtn.innerHTML = 'Checking engines…'; }
      else if (!runBtn.dataset.busy) { runBtn.disabled = false; runBtn.innerHTML = '&#8635; Run AI visibility check'; }
    }
    if (avState.running) avStartPolling();
    if (avEl('av-updated')) avEl('av-updated').innerText = avState.updatedAt ? ('Last check ' + avAgo(avState.updatedAt)) : 'Never run';
    if (!hasData) {
      mainEl.style.display = 'none';
      emptyEl.style.display = '';
      emptyEl.innerHTML = anyConfigured
        ? `Track how often <b>${avEsc(avState.brand)}</b> is recommended across AI answer engines. Click <b>Run AI visibility check</b> to run your tracked prompts across ${avState.engines.filter(e => e.configured).map(e => e.label).join(', ')} and build your first score.`
        : `No AI engines are connected yet. Add <b>GEMINI_API_KEY</b> in Settings/Railway to check Google's AI now — and <b>OPENAI_API_KEY</b> / <b>PERPLEXITY_API_KEY</b> to also track ChatGPT and Perplexity. Each engine lights up automatically once its key is set.`;
      return;
    }
    emptyEl.style.display = 'none';
    mainEl.style.display = '';
    avRenderScore();
    avRenderChart();
    avRenderEngineBreakdown();
    avRenderLeaderboard();
  }

  function avAgo(iso) {
    try {
      const then = new Date(iso).getTime(); const s = Math.max(0, (Date.now() - then) / 1000);
      if (s < 60) return 'just now';
      if (s < 3600) return Math.floor(s / 60) + 'm ago';
      if (s < 86400) return Math.floor(s / 3600) + 'h ago';
      if (s < 86400 * 7) return Math.floor(s / 86400) + 'd ago';
      return new Date(iso).toLocaleDateString();
    } catch (e) { return ''; }
  }

  async function loadAiVisibility(category) {
    try {
      const filterEl = avEl('av-service-filter');
      const cat = category !== undefined ? category : (filterEl ? filterEl.value : 'all');
      const url = cat && cat !== 'all' ? `/api/ai-visibility?category=${encodeURIComponent(cat)}` : '/api/ai-visibility';
      const res = await fetch(url);
      avState = await res.json();
      if (avState && avState.promptSetVersion && avEl('av-promptset-version')) {
        avEl('av-promptset-version').innerText = 'Prompt Set v' + avState.promptSetVersion;
      }
      avRender();
    } catch (e) { /* leave as-is */ }
  }
  global.loadAiVisibility = loadAiVisibility;

  // Poll while a check runs in the background (scheduled or long manual run).
  let avPollTimer = null;
  function avStartPolling() {
    if (avPollTimer) return;
    avPollTimer = setInterval(async () => {
      try {
        const r = await fetch('/api/ai-visibility'); const d = await r.json();
        if (!d.running) { clearInterval(avPollTimer); avPollTimer = null; const rb = avEl('av-run'); if (rb) delete rb.dataset.busy; avState = d; avRender(); }
      } catch (e) { clearInterval(avPollTimer); avPollTimer = null; }
    }, 5000);
  }

  document.querySelectorAll('#aio-tab .av-mtab').forEach(btn => {
    btn.addEventListener('click', () => { avMetric = btn.dataset.metric; if (avState && avState.latest) { avRenderScore(); avRenderChart(); } });
  });
  const avServiceFilter = avEl('av-service-filter');
  if (avServiceFilter) {
    avServiceFilter.addEventListener('change', () => loadAiVisibility(avServiceFilter.value));
  }

  const avRunBtn = avEl('av-run');
  if (avRunBtn) avRunBtn.addEventListener('click', async () => {
    if (avState && !avState.anyConfigured) { alert('No AI engines are connected. Add GEMINI_API_KEY (and optionally OPENAI_API_KEY / PERPLEXITY_API_KEY) in Railway, then run again.'); return; }
    avRunBtn.disabled = true; avRunBtn.dataset.busy = '1'; avRunBtn.innerHTML = 'Checking engines…';
    const selectedCat = avServiceFilter ? avServiceFilter.value : 'all';
    const payload = {};
    if (selectedCat && selectedCat !== 'all') {
      payload.serviceCategories = [selectedCat];
    }
    try {
      const r = await authFetch('/api/ai-visibility/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.error || 'Run failed');
      delete avRunBtn.dataset.busy;
      await loadAiVisibility(selectedCat);
    } catch (e) { delete avRunBtn.dataset.busy; alert('AI visibility check failed: ' + e.message); await loadAiVisibility(selectedCat); }
  });
  // Auto-weekly toggle
  const avAutoBox = avEl('av-auto');
  if (avAutoBox) avAutoBox.addEventListener('change', async () => {
    try {
      const r = await authFetch('/api/ai-visibility/toggle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: avAutoBox.checked }) });
      const d = await r.json(); if (!r.ok || !d.success) throw new Error(d.error || 'Toggle failed');
    } catch (e) { avAutoBox.checked = !avAutoBox.checked; alert('Could not update auto-weekly: ' + e.message); }
  });
  // Prompt editor
  const avEditBtn = avEl('av-edit-prompts'), avPromptsPanel = avEl('av-prompts-panel'), avPromptsText = avEl('av-prompts-text');
  if (avEditBtn) avEditBtn.addEventListener('click', () => {
    const open = avPromptsPanel.style.display !== 'none';
    if (open) { avPromptsPanel.style.display = 'none'; return; }
    avPromptsText.value = (avState && avState.prompts ? avState.prompts : []).join('\n');
    avPromptsPanel.style.display = 'block';
  });
  const avPromptsCancel = avEl('av-prompts-cancel');
  if (avPromptsCancel) avPromptsCancel.addEventListener('click', () => { avPromptsPanel.style.display = 'none'; });

  // Preset loaders in prompt editor
  document.querySelectorAll('.av-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const cat = btn.dataset.cat;
      const approved = (avState && avState.approvedServicePrompts) || {};
      const toAdd = [];
      if (cat === 'all') {
        Object.values(approved).forEach(list => { if (Array.isArray(list)) toAdd.push(...list); });
      } else if (Array.isArray(approved[cat])) {
        toAdd.push(...approved[cat]);
      }
      if (!toAdd.length) return;
      const current = avPromptsText.value.split('\n').map(s => s.trim()).filter(Boolean);
      const combined = Array.from(new Set([...current, ...toAdd])).slice(0, 25);
      avPromptsText.value = combined.join('\n');
    });
  });

  const avPromptsSave = avEl('av-prompts-save');
  if (avPromptsSave) avPromptsSave.addEventListener('click', async () => {
    const list = avPromptsText.value.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 25);
    if (!list.length) { alert('Add at least one search prompt.'); return; }
    avPromptsSave.disabled = true; avPromptsSave.innerText = 'Saving…';
    try {
      const r = await authFetch('/api/ai-visibility/prompts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompts: list }) });
      const d = await r.json(); if (!r.ok || !d.success) throw new Error(d.error || 'Save failed');
      if (avState) avState.prompts = d.prompts;
      avPromptsPanel.style.display = 'none';
    } catch (e) { alert('Could not save prompts: ' + e.message); }
    finally { avPromptsSave.disabled = false; avPromptsSave.innerText = 'Save prompts'; }
  });

  const avPromptsMerge = avEl('av-prompts-merge');
  if (avPromptsMerge) avPromptsMerge.addEventListener('click', async () => {
    const list = avPromptsText.value.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 25);
    if (!list.length) { alert('Add at least one search prompt.'); return; }
    avPromptsMerge.disabled = true; avPromptsMerge.innerText = 'Merging…';
    try {
      const r = await authFetch('/api/ai-visibility/prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompts: list, preserveExisting: true }),
      });
      const d = await r.json(); if (!r.ok || !d.success) throw new Error(d.error || 'Merge failed');
      if (avState) avState.prompts = d.prompts;
      avPromptsPanel.style.display = 'none';
    } catch (e) { alert('Could not merge prompts: ' + e.message); }
    finally { avPromptsMerge.disabled = false; avPromptsMerge.innerText = 'Merge & preserve existing'; }
  });

  // --- FACTCHECK / BRAND-ACCURACY MONITOR (P4a) ---
  let fcState = null, fcPollTimer = null;
  function fcAccClass(a) { return a == null ? 'na' : a >= 85 ? 'good' : a >= 50 ? 'warn' : 'bad'; }
  function fcRender() {
    if (!fcState) return;
    const upd = avEl('fc-updated'); if (upd) upd.innerText = fcState.updatedAt ? ('Checked ' + avAgo(fcState.updatedAt)) : '';
    const runBtn = avEl('fc-run');
    if (runBtn) { if (fcState.running) { runBtn.disabled = true; runBtn.innerHTML = 'Checking…'; if (!fcPollTimer) fcStartPolling(); } else if (!runBtn.dataset.busy) { runBtn.disabled = false; runBtn.innerHTML = 'Run FactCheck'; } }
    const body = avEl('fc-body'); if (!body) return;
    const latest = fcState.latest;
    if (!latest) {
      body.innerHTML = `<div class="fc-empty">${fcState.anyConfigured
        ? 'Click <b>Run FactCheck</b> to see what each AI engine believes about your business — and where it&rsquo;s wrong.'
        : 'Connect an AI engine (add <b>GEMINI_API_KEY</b> in Settings) to run FactCheck.'}</div>`;
      return;
    }
    body.innerHTML = (latest.results || []).map(r => {
      if (r.error) return `<div class="fc-engine"><div class="fc-engine-top"><span class="fc-engine-name">${avEsc(r.label)}</span><span class="fc-acc na">unavailable</span></div><div class="fc-summary">${avEsc(r.error)}</div></div>`;
      const wrong = (r.issues || []).filter(i => !i.correct);
      const right = (r.issues || []).filter(i => i.correct);
      const accTxt = r.accuracy == null ? 'No firm claims' : (r.accuracy + '% accurate');
      const wrongHtml = wrong.map(i => `<div class="fc-issue wrong"><span class="ic">&#9888;</span><span><b>${avEsc(i.aiClaim)}</b>${i.truth ? ` &rarr; <span class="truth">${avEsc(i.truth)}</span>` : ''}${i.note ? ` <span style="color:var(--text-dark)">(${avEsc(i.note)})</span>` : ''}</span></div>`).join('');
      const rightLine = right.length ? `<div class="fc-issue ok"><span class="ic">&#10003;</span><span>${right.length} claim${right.length > 1 ? 's' : ''} verified correct</span></div>` : '';
      return `<div class="fc-engine">
        <div class="fc-engine-top"><span class="fc-engine-name">${avEsc(r.label)}</span><span class="fc-acc ${fcAccClass(r.accuracy)}">${wrong.length ? wrong.length + ' issue' + (wrong.length > 1 ? 's' : '') + ' · ' : ''}${accTxt}</span></div>
        ${r.summary ? `<div class="fc-summary">${avEsc(r.summary)}</div>` : ''}
        ${wrongHtml}${rightLine}
      </div>`;
    }).join('') || '<div class="fc-empty">No engine responses.</div>';
  }
  function fcStartPolling() {
    if (fcPollTimer) return;
    fcPollTimer = setInterval(async () => {
      try { const r = await fetch('/api/ai-factcheck'); const d = await r.json(); if (!d.running) { clearInterval(fcPollTimer); fcPollTimer = null; const rb = avEl('fc-run'); if (rb) delete rb.dataset.busy; fcState = d; fcRender(); } }
      catch (e) { clearInterval(fcPollTimer); fcPollTimer = null; }
    }, 5000);
  }
  async function loadFactCheck() {
    try { const r = await fetch('/api/ai-factcheck'); fcState = await r.json(); fcRender(); } catch (e) { /* leave */ }
  }
  global.loadFactCheck = loadFactCheck;
  const fcRunBtn = avEl('fc-run');
  if (fcRunBtn) fcRunBtn.addEventListener('click', async () => {
    if (fcState && !fcState.anyConfigured) { alert('No AI engines are connected. Add GEMINI_API_KEY (and optionally OPENAI_API_KEY / PERPLEXITY_API_KEY) in Railway, then run again.'); return; }
    fcRunBtn.disabled = true; fcRunBtn.dataset.busy = '1'; fcRunBtn.innerHTML = 'Checking…';
    try {
      const r = await authFetch('/api/ai-factcheck/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.error || 'Run failed');
      delete fcRunBtn.dataset.busy; await loadFactCheck();
    } catch (e) { delete fcRunBtn.dataset.busy; alert('FactCheck failed: ' + e.message); await loadFactCheck(); }
  });

  // --- AI CRAWLER ACCESS AUDIT (P4b) ---
  let acState = null, acPollTimer = null;
  function acPill(status) { return status === 'blocked' ? 'bad' : status === 'partial' ? 'warn' : 'good'; }
  function acPillText(status) { return status === 'blocked' ? 'Blocked' : status === 'partial' ? 'Partial' : 'Allowed'; }
  function acRender() {
    if (!acState) return;
    const upd = avEl('ac-updated'); if (upd) upd.innerText = acState.updatedAt ? ('Checked ' + avAgo(acState.updatedAt)) : '';
    const runBtn = avEl('ac-run');
    if (runBtn) { if (acState.running) { runBtn.disabled = true; runBtn.innerHTML = 'Checking…'; if (!acPollTimer) acStartPolling(); } else if (!runBtn.dataset.busy) { runBtn.disabled = false; runBtn.innerHTML = 'Check access'; } }
    const body = avEl('ac-body'); if (!body) return;
    const l = acState.latest;
    if (!l) { body.innerHTML = `<div class="fc-empty">Click <b>Check access</b> to scan <b>${avEsc(acState.site || 'your site')}/robots.txt</b> and confirm the AI engines are allowed to read your site.</div>`; return; }
    const banner = l.blocked > 0
      ? `<div class="ac-banner bad">&#9888; ${l.blocked} of ${l.total} AI crawlers are BLOCKED in robots.txt — those engines can't read your site. Fix this first.</div>`
      : `<div class="ac-banner good">&#10003; All ${l.total} major AI crawlers are allowed to read ${avEsc(l.site)}.</div>`;
    const grid = `<div class="ac-grid">` + (l.bots || []).map(b =>
      `<div class="ac-bot"><div><div class="ac-bot-name">${avEsc(b.label)}</div><div class="ac-bot-purpose">${avEsc(b.purpose)}</div></div><span class="ac-pill ${acPill(b.status)}">${acPillText(b.status)}</span></div>`
    ).join('') + `</div>`;
    const note = !l.hadRobots
      ? `<div class="ac-note">No <b>robots.txt</b> was found at ${avEsc(l.robotsUrl)} — that means the site is open to all crawlers (fine for AI visibility). ${l.fetchError ? '(' + avEsc(l.fetchError) + ')' : ''}</div>`
      : (l.blocked > 0 ? `<div class="ac-note">To unblock, remove the <code>Disallow: /</code> rule for the blocked bots in your robots.txt (in GoHighLevel site settings), or replace it with <code>Allow: /</code>.</div>` : `<div class="ac-note">Checked ${avEsc(l.robotsUrl)}. Re-run after any robots.txt change.</div>`);
    body.innerHTML = banner + grid + note;
  }
  function acStartPolling() {
    if (acPollTimer) return;
    acPollTimer = setInterval(async () => {
      try { const r = await fetch('/api/ai-crawlers'); const d = await r.json(); if (!d.running) { clearInterval(acPollTimer); acPollTimer = null; const rb = avEl('ac-run'); if (rb) delete rb.dataset.busy; acState = d; acRender(); } }
      catch (e) { clearInterval(acPollTimer); acPollTimer = null; }
    }, 4000);
  }
  async function loadCrawlers() {
    try { const r = await fetch('/api/ai-crawlers'); acState = await r.json(); acRender(); } catch (e) { /* leave */ }
  }
  global.loadCrawlers = loadCrawlers;
  const acRunBtn = avEl('ac-run');
  if (acRunBtn) acRunBtn.addEventListener('click', async () => {
    acRunBtn.disabled = true; acRunBtn.dataset.busy = '1'; acRunBtn.innerHTML = 'Checking…';
    try {
      const r = await authFetch('/api/ai-crawlers/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.error || 'Check failed');
      delete acRunBtn.dataset.busy; await loadCrawlers();
    } catch (e) { delete acRunBtn.dataset.busy; alert('Crawler check failed: ' + e.message); await loadCrawlers(); }
  });

  // --- REDDIT VISIBILITY ENGINE (P4c) ---
  let rdState = null, rdPollTimer = null;
  function rdRender() {
    if (!rdState) return;
    const upd = avEl('rd-updated'); if (upd) upd.innerText = rdState.updatedAt ? ('Found ' + avAgo(rdState.updatedAt)) : '';
    const runBtn = avEl('rd-run');
    if (runBtn) { if (rdState.running) { runBtn.disabled = true; runBtn.innerHTML = 'Searching Reddit…'; if (!rdPollTimer) rdStartPolling(); } else if (!runBtn.dataset.busy) { runBtn.disabled = false; runBtn.innerHTML = 'Find Reddit threads'; } }
    const body = avEl('rd-body'); if (!body) return;
    const l = rdState.latest;
    if (!l) { body.innerHTML = `<div class="fc-empty">${rdState.anyConfigured ? 'Click <b>Find Reddit threads</b> to surface real discussions where you can add value and get cited by AI.' : 'Add your <b>Gemini key</b> in Settings — Reddit discovery uses live Google Search.'}</div>`; return; }
    if (!l.threads || !l.threads.length) { body.innerHTML = `<div class="fc-empty">No clear Reddit threads surfaced this time. Try again later — new discussions appear all the time.</div>`; return; }
    body.innerHTML = l.threads.map(t => `
      <div class="rd-thread">
        <div class="rd-thread-top">${t.subreddit ? `<span class="rd-sub">${avEsc(t.subreddit)}</span>` : ''}<a class="rd-title" href="${avEsc(t.url)}" target="_blank" rel="noopener">${avEsc(t.title)} &#8599;</a></div>
        ${t.why ? `<div class="rd-why">${avEsc(t.why)}</div>` : ''}
        ${t.angle ? `<div class="rd-angle"><b>How to add value:</b> ${avEsc(t.angle)}</div>` : ''}
      </div>`).join('') +
      `<div class="rd-note">Engage as a real person: be genuinely helpful, disclose that you run Best Day Fitness, and follow each subreddit&rsquo;s self-promotion rules. Spammy posts get removed and hurt you.</div>`;
  }
  function rdStartPolling() {
    if (rdPollTimer) return;
    rdPollTimer = setInterval(async () => {
      try { const r = await fetch('/api/reddit-threads'); const d = await r.json(); if (!d.running) { clearInterval(rdPollTimer); rdPollTimer = null; const rb = avEl('rd-run'); if (rb) delete rb.dataset.busy; rdState = d; rdRender(); } }
      catch (e) { clearInterval(rdPollTimer); rdPollTimer = null; }
    }, 5000);
  }
  async function loadReddit() {
    try { const r = await fetch('/api/reddit-threads'); rdState = await r.json(); rdRender(); } catch (e) { /* leave */ }
  }
  global.loadReddit = loadReddit;
  const rdRunBtn = avEl('rd-run');
  if (rdRunBtn) rdRunBtn.addEventListener('click', async () => {
    if (rdState && !rdState.anyConfigured) { alert('Add your Gemini key in Settings to search Reddit (this runs a live Google search).'); return; }
    rdRunBtn.disabled = true; rdRunBtn.dataset.busy = '1'; rdRunBtn.innerHTML = 'Searching Reddit…';
    try {
      const r = await authFetch('/api/reddit-threads/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.error || 'Search failed');
      delete rdRunBtn.dataset.busy; await loadReddit();
    } catch (e) { delete rdRunBtn.dataset.busy; alert('Reddit search failed: ' + e.message); await loadReddit(); }
  });



  global.loadAiVisibilitySuite = async function loadAiVisibilitySuite() {
    await Promise.all([
      loadAiVisibility(),
      loadFactCheck(),
      loadCrawlers(),
      loadReddit(),
      fetchAioHistory(),
      fetchAioSchemas(),
    ]);
  };
})(window);
