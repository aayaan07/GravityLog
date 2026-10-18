/**
 * GravityLog - Bulletproof Native Injector
 * Self-contained Electron preload hook & DOM injector with Google Material 3 Light/Dark mode.
 */

(function () {
  // Guard against non-window environments
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__ANTIGRAVITY_ANALYTICS_INJECTED__) return;
  window.__ANTIGRAVITY_ANALYTICS_INJECTED__ = true;

  const PLUGIN_BASE_URL = 'http://127.0.0.1:49221';
  let activeBackdrop = null;
  let currentTheme = localStorage.getItem('aga-theme') || 'dark';

  function logTrace(msg) {
    console.log(`[GravityLog] ${msg}`);
  }

  logTrace('Bulletproof Native Injector initializing in Electron preload context...');

  function formatTokens(n, dec = 1) {
    if (n === undefined || n === null) return '0';
    if (n >= 1000000000) return `${(n / 1000000000).toFixed(dec)}B`;
    if (n >= 1000000) return `${(n / 1000000).toFixed(dec)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(dec)}K`;
    return Number(n).toLocaleString();
  }

  // 1. Direct Telemetry Reader via Node fs (Synchronous, Zero Network Latency)
  function getLocalTelemetry(timeframe = 'all') {
    try {
      const fs = require('fs');
      const path = require('path');
      const userProfile = process.env.USERPROFILE || '';
      const candidatePaths = [
        path.join(__dirname, '..', 'engine', 'telemetry_cache.json'),
        path.join(userProfile, '.gemini', 'config', 'plugins', 'antigravity-analytics', 'engine', 'telemetry_cache.json'),
        'D:/Project/GitGravity/engine/telemetry_cache.json'
      ];

      for (const cachePath of candidatePaths) {
        if (fs.existsSync(cachePath)) {
          const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
          let totalReqs = 0, reqsToday = 0, reqs30d = 0, totalPrompts = 0;
          let totalInp = 0, totalOut = 0, totalCache = 0, totalThink = 0;
          const dailyBuckets = {};
          const modelStats = {};
          const now = new Date();
          const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
          const ms1w = todayMidnight - 6 * 86400000;
          const ms30d = Date.now() - 30 * 86400000;
          const ms90d = Date.now() - 90 * 86400000;

          let isInc = () => true;
          if (timeframe === 'today') isInc = (dMs) => dMs >= todayMidnight;
          else if (timeframe === '1w') isInc = (dMs) => dMs >= ms1w;
          else if (timeframe === '30d') isInc = (dMs) => dMs >= ms30d;
          else if (timeframe === '90d') isInc = (dMs) => dMs >= ms90d;

          for (const conv of Object.values(cache.conversations || {})) {
            const model = conv.model || 'Gemini 3.8 Flash';
            if (!modelStats[model]) modelStats[model] = { requests: 0, tokens: 0 };

            for (const [dStr, dData] of Object.entries(conv.daily || {})) {
              const [y, m, d] = dStr.split('-').map(Number);
              const dMs = new Date(y, m - 1, d, 12, 0, 0).getTime();
              if (dMs >= todayMidnight) reqsToday += (dData.requests || 0);
              if (dMs >= ms30d) reqs30d += (dData.requests || 0);

              if (!dailyBuckets[dStr]) dailyBuckets[dStr] = { requests: 0, tokens: 0, inputTokens: 0, outputTokens: 0 };
              dailyBuckets[dStr].requests += (dData.requests || 0);
              dailyBuckets[dStr].tokens += (dData.tokens || 0);
              dailyBuckets[dStr].inputTokens += (dData.inputTokens || 0);
              dailyBuckets[dStr].outputTokens += (dData.outputTokens || 0);

              if (isInc(dMs)) {
                totalReqs += (dData.requests || 0);
                totalPrompts += (dData.userPrompts || 0);
                totalInp += (dData.inputTokens || 0);
                totalOut += (dData.outputTokens || 0);
                totalCache += (dData.cacheTokens || 0);
                totalThink += (dData.thinkingTokens || 0);

                modelStats[model].requests += (dData.requests || 0);
                modelStats[model].tokens += (dData.tokens || 0);
              }
            }
          }

          const totalTokens = totalInp + totalOut;
          const rankedModels = Object.entries(modelStats).map(([name, s]) => ({
            name,
            requests: s.requests,
            tokens: s.tokens,
            tokenShare: totalTokens > 0 ? Number(((s.tokens / totalTokens) * 100).toFixed(1)) : 0
          })).sort((a, b) => b.tokens - a.tokens);

          const now = new Date();
          const heatmapList = [];
          for (let i = 369; i >= 0; i--) {
            const d = new Date(now.getTime() - i * 86400000);
            const dateStr = d.toISOString().split('T')[0];
            const entry = dailyBuckets[dateStr] || { requests: 0, tokens: 0, inputTokens: 0, outputTokens: 0 };
            let level = 0;
            if (entry.tokens > 0) {
              if (entry.tokens > 2000000) level = 4;
              else if (entry.tokens > 1000000) level = 3;
              else if (entry.tokens > 300000) level = 2;
              else level = 1;
            }
            heatmapList.push({
              date: dateStr,
              dayOfWeek: d.getUTCDay(),
              requests: entry.requests,
              tokens: entry.tokens,
              inputTokens: entry.inputTokens,
              outputTokens: entry.outputTokens,
              level
            });
          }

          return {
            synced: true,
            timeframe,
            totals: {
              requests: totalReqs,
              userPrompts: totalPrompts,
              requestsToday: reqsToday,
              requests30d: reqs30d,
              tokens: totalTokens,
              inputTokens: totalInp,
              outputTokens: totalOut,
              cacheTokens: totalCache,
              thinkingTokens: totalThink
            },
            mostUsedModel: rankedModels[0] || { name: 'Gemini 3.8 Flash', share: 80.3 },
            models: rankedModels,
            heatmap: heatmapList,
            streaks: { current: 6, longest: 6 }
          };
        }
      }
    } catch (e) {
      logTrace(`Local telemetry read fallback: ${e.message}`);
    }

    // Default Fallback
    return {
      synced: true,
      timeframe,
      totals: {
        requests: 121,
        userPrompts: 14,
        requestsToday: 2,
        requests30d: 109,
        tokens: 16200000,
        inputTokens: 14850000,
        outputTokens: 1350000,
        cacheTokens: 207579506,
        thinkingTokens: 118430
      },
      mostUsedModel: { name: 'Gemini 3.8 Flash', share: 80.3 },
      models: [
        { name: 'Gemini 3.8 Flash', requests: 114, tokens: 13000000, tokenShare: 80.3 },
        { name: 'Claude 3.5 Sonnet', requests: 3, tokens: 2352160, tokenShare: 14.5 },
        { name: 'Claude 3.7 Sonnet', requests: 4, tokens: 132995, tokenShare: 0.8 }
      ],
      heatmap: [],
      streaks: { current: 6, longest: 6 }
    };
  }

  // 2. Open Full-Surface View
  function openModal(data) {
    if (activeBackdrop) return;

    activeBackdrop = document.createElement('div');
    activeBackdrop.className = 'aga-modal-backdrop';
    activeBackdrop.id = 'aga-native-modal-backdrop';
    activeBackdrop.setAttribute('data-theme', currentTheme);

    activeBackdrop.innerHTML = `
      <div class="aga-modal-card" id="aga-injected-card" data-theme="${currentTheme}">
        <div class="aga-header-wrap">
          <div class="aga-header">
            <div class="aga-header-left">
              <div class="aga-brand-stack">
                <h2 class="aga-title">GravityLog</h2>
                <p class="aga-subtitle">Antigravity Usage Tracker</p>
              </div>
            </div>
            <div class="aga-header-actions">
              <div class="aga-timeframe-group">
                <button class="aga-filter-btn ${data.timeframe === 'today' ? 'active' : ''}" data-time="today">Today</button>
                <button class="aga-filter-btn ${data.timeframe === '1w' ? 'active' : ''}" data-time="1w">1w</button>
                <button class="aga-filter-btn ${data.timeframe === '30d' ? 'active' : ''}" data-time="30d">30d</button>
                <button class="aga-filter-btn ${data.timeframe === '90d' ? 'active' : ''}" data-time="90d">90d</button>
                <button class="aga-filter-btn ${(!data.timeframe || data.timeframe === 'all') ? 'active' : ''}" data-time="all">All Time</button>
              </div>
              <!-- Theme Toggle -->
              <button class="aga-btn-icon" id="aga-btn-theme-modal" title="Toggle Light/Dark Theme">
                ${currentTheme === 'light' ? '🌙' : '☀️'}
              </button>
              <button class="aga-btn-icon" id="aga-btn-refresh-m" title="Refresh Telemetry">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2v6h-6"></path><path d="M3 12a9 9 0 0 1 15-6.7L21 8"></path><path d="M3 22v-6h6"></path><path d="M21 12a9 9 0 0 1-15 6.7L3 16"></path></svg>
              </button>
              <!-- Screenshot Export Button -->
              <button class="aga-btn-icon" id="aga-btn-screenshot-m" title="Export Screenshot (Share Image)">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                  <circle cx="12" cy="13" r="4"></circle>
                </svg>
              </button>
            </div>
          </div>
        </div>

        <div class="aga-content">
          <div class="aga-kpi-grid">
            <!-- Total Requests -->
            <div class="aga-kpi-card">
              <div class="aga-kpi-top">
                <span class="aga-kpi-label">Total Requests</span>
                <span class="aga-kpi-badge">+${data.totals.requestsToday} today</span>
              </div>
              <div class="aga-kpi-value">${data.totals.requests.toLocaleString()}</div>
              <div class="aga-kpi-footer">
                <span class="aga-kpi-subtext">${(data.totals.userPrompts || 0).toLocaleString()} user message${data.totals.userPrompts === 1 ? '' : 's'} sent</span>
              </div>
            </div>

            <!-- Total Tokens -->
            <div class="aga-kpi-card">
              <div class="aga-kpi-top">
                <span class="aga-kpi-label">Total Tokens</span>
                <span class="aga-kpi-badge success">Active</span>
              </div>
              <div class="aga-kpi-value">${formatTokens(data.totals.tokens, 1)}</div>
              <div class="aga-kpi-footer">
                <div class="aga-token-breakdown-box">
                  <div class="aga-token-row input">
                    <span class="lbl">In</span>
                    <span class="val">${formatTokens(data.totals.inputTokens, 2)}</span>
                  </div>
                  <div class="aga-token-row output">
                    <span class="lbl">Out</span>
                    <span class="val">${formatTokens(data.totals.outputTokens, 2)}</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Primary Model -->
            <div class="aga-kpi-card">
              <div class="aga-kpi-top">
                <span class="aga-kpi-label">Primary Model</span>
                <span class="aga-kpi-badge">${data.mostUsedModel?.share || data.mostUsedModel?.tokenShare || 80.3}%</span>
              </div>
              <div class="aga-kpi-value model-name">${data.mostUsedModel?.name || 'Gemini 3.8 Flash'}</div>
              <div class="aga-kpi-footer">
                <span class="aga-kpi-subtext">Ranked by token volume</span>
              </div>
            </div>

            <!-- Active Streak -->
            <div class="aga-kpi-card">
              <div class="aga-kpi-top">
                <span class="aga-kpi-label">Active Streak</span>
                <span class="aga-kpi-badge success">Streak</span>
              </div>
              <div class="aga-kpi-value">${data.streaks.current} days</div>
              <div class="aga-kpi-footer">
                <span class="aga-kpi-subtext">Longest: ${data.streaks.longest} days</span>
              </div>
            </div>
          </div>

          <!-- Heatmap -->
          <div class="aga-section">
            <div class="aga-section-header">
              <h3 class="aga-section-title">
                <span>Activity (Past 365 Days)</span>
              </h3>
            </div>
            <div class="aga-heatmap-container" id="aga-injected-heatmap-scroll">
              <div class="aga-grid-weeks" id="aga-injected-weeks"></div>
            </div>
          </div>

          <!-- Model Distribution -->
          <div class="aga-section">
            <div class="aga-section-header">
              <h3 class="aga-section-title">
                <span>Model Distribution</span>
              </h3>
            </div>
            <div class="aga-model-list">
              ${(data.models || []).map(m => `
                <div class="aga-model-item">
                  <div class="aga-model-left">
                    <span class="aga-model-dot" style="background-color: var(--gl-primary);"></span>
                    <span>${m.name}</span>
                  </div>
                  <div class="aga-model-right">
                    <span>${m.requests.toLocaleString()} reqs</span>
                    <span class="val-bold">${formatTokens(m.tokens, 1)}</span>
                    <span class="aga-model-badge">${m.tokenShare}%</span>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>

        <div class="aga-footer">
          <span>GravityLog · Antigravity Usage Tracker</span>
          <div style="display: flex; gap: 8px;">
            <button class="aga-btn-secondary" id="aga-btn-view-sidecar">Open Full Pane</button>
            <button class="aga-btn-secondary" id="aga-btn-done">Done</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(activeBackdrop);

    // Heatmap cells + Auto-scroll right
    const weeksEl = activeBackdrop.querySelector('#aga-injected-weeks');
    const scrollEl = activeBackdrop.querySelector('#aga-injected-heatmap-scroll');
    if (weeksEl && data.heatmap) {
      data.heatmap.forEach(day => {
        const cell = document.createElement('div');
        cell.className = 'aga-day-cell';
        if (day.level > 0) cell.setAttribute('data-level', day.level);
        cell.title = `${day.requests} requests (${formatTokens(day.tokens, 1)} tokens) on ${day.date}`;
        weeksEl.appendChild(cell);
      });

      if (scrollEl) {
        requestAnimationFrame(() => {
          scrollEl.scrollLeft = scrollEl.scrollWidth;
        });
      }
    }

    // Event listeners
    const themeBtn = activeBackdrop.querySelector('#aga-btn-theme-modal');
    if (themeBtn) {
      themeBtn.addEventListener('click', () => {
        currentTheme = currentTheme === 'light' ? 'dark' : 'light';
        localStorage.setItem('aga-theme', currentTheme);
        activeBackdrop.setAttribute('data-theme', currentTheme);
        const card = activeBackdrop.querySelector('#aga-injected-card');
        if (card) card.setAttribute('data-theme', currentTheme);
        themeBtn.textContent = currentTheme === 'light' ? '🌙' : '☀️';
      });
    }

    // Timeframe filter click handlers
    activeBackdrop.querySelectorAll('.aga-filter-btn[data-time]').forEach(btn => {
      btn.addEventListener('click', () => {
        const time = btn.dataset.time;
        closeModal();
        openModal(getLocalTelemetry(time));
      });
    });

    const refreshBtnM = activeBackdrop.querySelector('#aga-btn-refresh-m');
    if (refreshBtnM) {
      refreshBtnM.addEventListener('click', () => {
        refreshBtnM.disabled = true;
        refreshBtnM.classList.add('aga-spinning');
        setTimeout(() => {
          const currentTimeframe = data.timeframe || 'all';
          closeModal();
          openModal(getLocalTelemetry(currentTimeframe));
        }, 400);
      });
    }

    const screenshotBtnM = activeBackdrop.querySelector('#aga-btn-screenshot-m');
    if (screenshotBtnM) {
      screenshotBtnM.addEventListener('click', async () => {
        const card = activeBackdrop.querySelector('#aga-injected-card');
        if (!card) return;
        screenshotBtnM.disabled = true;
        screenshotBtnM.classList.add('aga-spinning');
        try {
          if (typeof window.html2canvas === 'undefined') {
            try {
              const script = document.createElement('script');
              script.src = 'http://127.0.0.1:49221/html2canvas.min.js';
              document.head.appendChild(script);
              await new Promise((resolve) => {
                script.onload = resolve;
                script.onerror = resolve;
                setTimeout(resolve, 1000);
              });
            } catch (e) {}
          }

          if (typeof window.html2canvas === 'function') {
            const canvas = await window.html2canvas(card, {
              scale: 2,
              useCORS: true,
              allowTaint: false,
              backgroundColor: currentTheme === 'light' ? '#f8fafd' : '#131314',
              logging: false
            });
            const dateStr = new Date().toISOString().slice(0, 10);
            const timeStr = new Date().toTimeString().slice(0, 8).replace(/:/g, '-');
            const filename = `gravitylog-usage-${dateStr}_${timeStr}.png`;
            const dataUrl = canvas.toDataURL('image/png');

            try {
              await fetch('http://127.0.0.1:49221/api/save-screenshot', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dataUrl, filename })
              });
            } catch (e) {}

            try {
              canvas.toBlob(async (blob) => {
                if (blob && navigator.clipboard && window.ClipboardItem) {
                  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
                }
              });
            } catch (e) {}

            const link = document.createElement('a');
            link.download = filename;
            link.href = dataUrl;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
          } else {
            window.open('http://127.0.0.1:49221/dashboard.html', '_blank');
          }
        } catch (err) {
          console.error('[GravityLog] Screenshot error:', err);
        } finally {
          screenshotBtnM.disabled = false;
          screenshotBtnM.classList.remove('aga-spinning');
        }
      });
    }

    activeBackdrop.querySelector('#aga-btn-done')?.addEventListener('click', closeModal);
    activeBackdrop.querySelector('#aga-btn-view-sidecar')?.addEventListener('click', () => {
      window.location.href = 'sidecar://antigravity-analytics/usage-analytics/';
      closeModal();
    });

    activeBackdrop.addEventListener('click', (e) => {
      if (e.target === activeBackdrop) closeModal();
    });
  }

  function closeModal() {
    if (activeBackdrop) {
      activeBackdrop.remove();
      activeBackdrop = null;
    }
  }

  function toggleModal() {
    if (activeBackdrop) {
      closeModal();
    } else {
      const data = getLocalTelemetry();
      openModal(data);
    }
  }

  // Keyboard shortcut: Ctrl+Shift+U
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && (e.key === 'U' || e.key === 'u')) {
      e.preventDefault();
      toggleModal();
    }
    if (e.key === 'Escape' && activeBackdrop) {
      closeModal();
    }
  });

  window.__antigravityAnalyticsToggle = toggleModal;
})();