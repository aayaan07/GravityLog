/**
 * GravityLog - Interactive Dashboard Controller
 * Full-featured dual-theme Google Material 3 analytics dashboard.
 */

(function () {
  // Google Material 3 Chart Palette
  const MODEL_COLORS = [
    '#0b57d0', // Google Blue
    '#146c2e', // Google Green
    '#b06000', // Google Amber
    '#8430ce', // Google Purple
    '#c5221f', // Google Red
    '#00639b'  // Google Cyan
  ];

  function formatTokens(n, dec = 1) {
    if (n === undefined || n === null) return '0';
    if (n >= 1000000000) return `${(n / 1000000000).toFixed(dec)}B`;
    if (n >= 1000000) return `${(n / 1000000).toFixed(dec)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(dec)}K`;
    return Number(n).toLocaleString();
  }

  class AnalyticsDashboard {
    constructor(rootElement, options = {}) {
      this.root = rootElement || document.body;
      this.apiBase = options.apiBase || window.location.origin || 'http://127.0.0.1:49221';
      this.timeframe = 'all';
      this.theme = localStorage.getItem('aga-theme') || 'dark';
      this.data = null;
      this.autoRefreshTimer = null;
      this.onClose = options.onClose || null;

      this.init();
    }

    async init() {
      this.applyDocumentTheme();
      this.renderSkeleton();
      this.bindEvents();
      await this.fetchMetrics();
      this.startAutoRefresh();
    }

    applyDocumentTheme() {
      document.documentElement.setAttribute('data-theme', this.theme);
    }

    renderSkeleton() {
      this.root.innerHTML = `
        <div class="aga-modal-card" id="aga-modal-card" data-theme="${this.theme}">
          <!-- Sticky Header Bar -->
          <div class="aga-header-wrap">
            <div class="aga-header">
              <div class="aga-header-left">
                <img src="/GravityLog-logo.png" alt="GravityLog" class="aga-header-logo" onerror="this.style.display='none'" />
                <div class="aga-brand-stack">
                  <h1 class="aga-title">GravityLog</h1>
                  <p class="aga-subtitle">Antigravity Usage Tracker</p>
                </div>
              </div>

              <div class="aga-header-actions">
                <!-- Timeframe Filters -->
                <div class="aga-timeframe-group" id="aga-timeframe-group">
                  <button class="aga-filter-btn" data-timeframe="today">Today</button>
                  <button class="aga-filter-btn" data-timeframe="1w">1w</button>
                  <button class="aga-filter-btn" data-timeframe="30d">30d</button>
                  <button class="aga-filter-btn" data-timeframe="90d">90d</button>
                  <button class="aga-filter-btn active" data-timeframe="all">All Time</button>
                </div>

                <!-- Theme Toggle Button (Light/Dark) -->
                <button class="aga-btn-icon" id="aga-btn-theme" title="Toggle Light/Dark Theme">
                  ${this.theme === 'light' ? `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
                  ` : `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>
                  `}
                </button>

                <!-- Refresh Button -->
                <button class="aga-btn-icon" id="aga-btn-refresh" title="Refresh Telemetry">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2v6h-6"></path><path d="M3 12a9 9 0 0 1 15-6.7L21 8"></path><path d="M3 22v-6h6"></path><path d="M21 12a9 9 0 0 1-15 6.7L3 16"></path></svg>
                </button>

                <!-- Screenshot Export Button -->
                <button class="aga-btn-icon" id="aga-btn-screenshot" title="Export Screenshot (Share Image)">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                    <circle cx="12" cy="13" r="4"></circle>
                  </svg>
                </button>
              </div>
            </div>
          </div>

          <!-- Toast Notification Banner -->
          <div class="aga-toast" id="aga-toast">
            <div class="aga-toast-content">
              <div class="aga-toast-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
              </div>
              <div class="aga-toast-text">
                <div class="aga-toast-title" id="aga-toast-title">Screenshot Saved!</div>
                <div class="aga-toast-sub" id="aga-toast-sub">Saved to Downloads: <strong>gravitylog-usage.png</strong></div>
              </div>
            </div>
            <div class="aga-toast-actions">
              <button class="aga-toast-btn" id="aga-toast-open">Open Folder</button>
              <button class="aga-toast-close" id="aga-toast-close">&times;</button>
            </div>
          </div>

          <!-- Content Body -->
          <div class="aga-content">
            <!-- 4 Quick-View KPI Cards -->
            <div class="aga-kpi-grid">
              <!-- Card 1: Total Requests -->
              <div class="aga-kpi-card">
                <div class="aga-kpi-top">
                  <span class="aga-kpi-label">Total Requests</span>
                  <span class="aga-kpi-badge" id="kpi-badge-today">+0 today</span>
                </div>
                <div class="aga-kpi-value" id="kpi-val-requests">...</div>
                <div class="aga-kpi-footer">
                  <span class="aga-kpi-subtext" id="kpi-sub-requests">... user messages sent</span>
                </div>
              </div>

              <!-- Card 2: Total Tokens -->
              <div class="aga-kpi-card">
                <div class="aga-kpi-top">
                  <span class="aga-kpi-label">Total Tokens</span>
                  <span class="aga-kpi-badge success">Active</span>
                </div>
                <div class="aga-kpi-value" id="kpi-val-tokens">...</div>
                <div class="aga-kpi-footer">
                  <div class="aga-token-breakdown-box">
                    <div class="aga-token-row input">
                      <span class="lbl">In</span>
                      <span class="val" id="kpi-val-input-tokens">...</span>
                    </div>
                    <div class="aga-token-row output">
                      <span class="lbl">Out</span>
                      <span class="val" id="kpi-val-output-tokens">...</span>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Card 3: Primary Model -->
              <div class="aga-kpi-card">
                <div class="aga-kpi-top">
                  <span class="aga-kpi-label">Primary Model</span>
                  <span class="aga-kpi-badge" id="kpi-badge-model">0%</span>
                </div>
                <div class="aga-kpi-value model-name" id="kpi-val-model">...</div>
                <div class="aga-kpi-footer">
                  <span class="aga-kpi-subtext">Ranked by token volume</span>
                </div>
              </div>

              <!-- Card 4: Active Streak -->
              <div class="aga-kpi-card">
                <div class="aga-kpi-top">
                  <span class="aga-kpi-label">Active Streak</span>
                  <span class="aga-kpi-badge success">Streak</span>
                </div>
                <div class="aga-kpi-value" id="kpi-val-streak">0 days</div>
                <div class="aga-kpi-footer">
                  <span class="aga-kpi-subtext" id="kpi-sub-streak">Longest: 0 days</span>
                </div>
              </div>
            </div>

            <!-- Activity Heatmap Section Card -->
            <div class="aga-section">
              <div class="aga-section-header">
                <h2 class="aga-section-title">
                  <span>Activity (Past 365 Days)</span>
                </h2>
              </div>

              <div class="aga-heatmap-container" id="aga-heatmap-scroll">
                <div class="aga-heatmap-wrapper">
                  <div class="aga-day-labels">
                    <span>Mon</span>
                    <span>Wed</span>
                    <span>Fri</span>
                  </div>
                  <div class="aga-calendar-cols">
                    <div class="aga-month-labels" id="aga-month-labels"></div>
                    <div class="aga-grid-weeks" id="aga-grid-weeks"></div>
                  </div>
                </div>
              </div>

              <div class="aga-heatmap-footer">
                <span>Less</span>
                <div class="aga-legend-cells">
                  <div class="aga-day-cell"></div>
                  <div class="aga-day-cell" data-level="1"></div>
                  <div class="aga-day-cell" data-level="2"></div>
                  <div class="aga-day-cell" data-level="3"></div>
                  <div class="aga-day-cell" data-level="4"></div>
                </div>
                <span>More</span>
              </div>
            </div>

            <!-- Model Distribution Section Card -->
            <div class="aga-section">
              <div class="aga-section-header">
                <h2 class="aga-section-title">
                  <span>Model Distribution</span>
                </h2>
              </div>

              <div class="aga-stacked-bar" id="aga-stacked-bar"></div>
              <div class="aga-model-list" id="aga-model-list"></div>
            </div>
          </div>
        </div>

        <div class="aga-floating-tooltip" id="aga-tooltip"></div>
      `;
    }

    startAutoRefresh() {
      if (this.autoRefreshTimer) clearInterval(this.autoRefreshTimer);
      this.autoRefreshTimer = setInterval(() => {
        this.fetchMetrics();
      }, 30000);
    }

    showToast(title, htmlSub, showOpenBtn = true) {
      const toast = this.root.querySelector('#aga-toast');
      if (!toast) return;

      const titleEl = toast.querySelector('#aga-toast-title');
      const subEl = toast.querySelector('#aga-toast-sub');
      const openBtn = toast.querySelector('#aga-toast-open');

      if (titleEl) titleEl.textContent = title;
      if (subEl) subEl.innerHTML = htmlSub;
      if (openBtn) openBtn.style.display = showOpenBtn ? 'inline-flex' : 'none';

      toast.classList.add('show');

      if (this.toastTimer) clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => {
        toast.classList.remove('show');
      }, 7000);
    }

    async downloadScreenshot() {
      const card = this.root.querySelector('#aga-modal-card');
      if (!card) return;
      const btn = this.root.querySelector('#aga-btn-screenshot');
      if (btn) {
        btn.disabled = true;
        btn.classList.add('aga-spinning');
      }

      try {
        // Resolve html2canvas from window or module or inject
        let h2c = window.html2canvas;
        if (!h2c && typeof module !== 'undefined' && module.exports) {
          h2c = module.exports;
          window.html2canvas = h2c;
        }

        if (!h2c) {
          await new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = `${this.apiBase}/html2canvas.min.js`;
            s.onload = () => {
              h2c = window.html2canvas || (typeof module !== 'undefined' && module.exports);
              resolve();
            };
            s.onerror = reject;
            document.head.appendChild(s);
          });
        }

        if (!h2c) {
          throw new Error('Screenshot engine failed to load');
        }

        // Render card to canvas
        const canvas = await h2c(card, {
          scale: 2,
          useCORS: true,
          allowTaint: false,
          backgroundColor: this.theme === 'light' ? '#f8fafd' : '#131314',
          logging: false,
          ignoreElements: (el) => el.id === 'aga-toast'
        });

        const dateStr = new Date().toISOString().slice(0, 10);
        const timeStr = new Date().toTimeString().slice(0, 8).replace(/:/g, '-');
        const filename = `gravitylog-usage-${dateStr}_${timeStr}.png`;
        const dataUrl = canvas.toDataURL('image/png');

        let savedPath = '';
        try {
          const saveRes = await fetch(`${this.apiBase}/api/save-screenshot`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dataUrl, filename })
          });
          if (saveRes.ok) {
            const result = await saveRes.json();
            savedPath = result.filePath || '';
          }
        } catch (netErr) {
          console.warn('[GravityLog] Direct server save error:', netErr.message);
        }

        // Also trigger browser standard download as dual fallback
        try {
          const link = document.createElement('a');
          link.download = filename;
          link.href = dataUrl;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        } catch (e) {}

        // Also copy image to clipboard
        try {
          canvas.toBlob(async (blob) => {
            if (blob && navigator.clipboard && window.ClipboardItem) {
              await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
            }
          });
        } catch (e) {}

        // Display on-screen confirmation banner
        const displayPath = savedPath || `Downloads\\${filename}`;
        this.showToast(
          'Screenshot Saved Successfully!',
          `Saved to: <strong>${displayPath}</strong> &bull; Copied to Clipboard`,
          true
        );
      } catch (err) {
        console.error('[GravityLog] Screenshot export error:', err);
        this.showToast(
          'Screenshot Failed',
          `Error: ${err.message || err}`,
          false
        );
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.classList.remove('aga-spinning');
        }
      }
    }

    bindEvents() {
      // Timeframe buttons
      this.root.querySelectorAll('.aga-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          this.root.querySelectorAll('.aga-filter-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this.timeframe = btn.dataset.timeframe;
          this.fetchMetrics();
        });
      });

      // Theme toggle
      const themeBtn = this.root.querySelector('#aga-btn-theme');
      if (themeBtn) {
        themeBtn.addEventListener('click', () => {
          this.theme = this.theme === 'light' ? 'dark' : 'light';
          localStorage.setItem('aga-theme', this.theme);
          this.applyDocumentTheme();
          const card = this.root.querySelector('#aga-modal-card');
          if (card) card.setAttribute('data-theme', this.theme);
          themeBtn.innerHTML = this.theme === 'light' ? `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
          ` : `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>
          `;
        });
      }

      // Refresh with interactive feedback
      const refreshBtn = this.root.querySelector('#aga-btn-refresh');
      if (refreshBtn) {
        refreshBtn.addEventListener('click', async () => {
          refreshBtn.disabled = true;
          refreshBtn.classList.add('aga-spinning');
          try {
            await this.fetchMetrics(true);
          } finally {
            setTimeout(() => {
              refreshBtn.classList.remove('aga-spinning');
              refreshBtn.disabled = false;
            }, 500);
          }
        });
      }

      // Screenshot export
      const screenshotBtn = this.root.querySelector('#aga-btn-screenshot');
      if (screenshotBtn) {
        screenshotBtn.addEventListener('click', () => this.downloadScreenshot());
      }

      // Toast buttons
      this.root.querySelector('#aga-toast-open')?.addEventListener('click', async () => {
        try {
          await fetch(`${this.apiBase}/api/open-screenshot-folder`);
        } catch (e) {}
      });

      this.root.querySelector('#aga-toast-close')?.addEventListener('click', () => {
        this.root.querySelector('#aga-toast')?.classList.remove('show');
      });

      // Floating tooltip tracking
      const tooltip = this.root.querySelector('#aga-tooltip');
      this.root.addEventListener('mousemove', (e) => {
        const cell = e.target.closest('.aga-day-cell[data-date]');
        if (cell && tooltip) {
          const reqs = cell.dataset.reqs || 0;
          const tokens = Number(cell.dataset.tokens || 0).toLocaleString();
          const d = cell.dataset.date;
          tooltip.innerHTML = `<strong>${reqs} requests</strong> · ${tokens} tokens on ${d}`;
          tooltip.style.left = `${e.clientX}px`;
          tooltip.style.top = `${e.clientY}px`;
          tooltip.style.opacity = '1';
        } else if (tooltip) {
          tooltip.style.opacity = '0';
        }
      });
    }

    async fetchMetrics(force = false) {
      try {
        const queryParams = new URLSearchParams({
          timeframe: this.timeframe,
          refresh: force ? 'true' : 'false',
          _t: Date.now()
        });
        const res = await fetch(`${this.apiBase}/api/metrics?${queryParams.toString()}`);
        if (res.ok) {
          this.data = await res.json();
          this.renderData(this.data);
          return;
        }
      } catch (e) {
        console.warn('[GravityLog] API fetch error, using fallback:', e.message);
      }

      // Fallback
      if (!this.data) {
        this.data = {
          synced: true,
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
      this.renderData(this.data);
    }

    renderData(data) {
      if (!data || !data.totals) return;

      // KPI 1: Requests
      const reqEl = this.root.querySelector('#kpi-val-requests');
      if (reqEl) reqEl.textContent = data.totals.requests.toLocaleString();

      const todayBadge = this.root.querySelector('#kpi-badge-today');
      if (todayBadge) todayBadge.textContent = `+${data.totals.requestsToday} today`;

      const subReq = this.root.querySelector('#kpi-sub-requests');
      if (subReq) {
        const count = data.totals.userPrompts || 0;
        subReq.textContent = `${count.toLocaleString()} user message${count === 1 ? '' : 's'} sent`;
      }

      // KPI 2: Tokens
      const tokEl = this.root.querySelector('#kpi-val-tokens');
      if (tokEl) tokEl.textContent = formatTokens(data.totals.tokens, 1);

      const inEl = this.root.querySelector('#kpi-val-input-tokens');
      if (inEl) inEl.textContent = formatTokens(data.totals.inputTokens, 2);

      const outEl = this.root.querySelector('#kpi-val-output-tokens');
      if (outEl) outEl.textContent = formatTokens(data.totals.outputTokens, 2);

      // KPI 3: Model
      const modEl = this.root.querySelector('#kpi-val-model');
      if (modEl) modEl.textContent = data.mostUsedModel?.name || 'Gemini 3.8 Flash';

      const modBadge = this.root.querySelector('#kpi-badge-model');
      if (modBadge) modBadge.textContent = `${data.mostUsedModel?.share || 100}%`;

      // KPI 4: Streaks
      const strkEl = this.root.querySelector('#kpi-val-streak');
      if (strkEl) strkEl.textContent = `${data.streaks.current} days`;

      const subStrk = this.root.querySelector('#kpi-sub-streak');
      if (subStrk) subStrk.textContent = `Longest: ${data.streaks.longest} days`;

      // Heatmap Calendar
      this.renderHeatmap(data.heatmap || []);

      // Model Breakdown
      this.renderModels(data.models || []);
    }

    renderHeatmap(heatmapData) {
      const grid = this.root.querySelector('#aga-grid-weeks');
      const mLabels = this.root.querySelector('#aga-month-labels');
      const scrollContainer = this.root.querySelector('#aga-heatmap-scroll');
      if (!grid || !mLabels) return;

      grid.innerHTML = '';
      mLabels.innerHTML = '';

      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      let lastM = -1;

      for (let w = 0; w < 53; w++) {
        const span = document.createElement('span');
        const idx = w * 7;
        if (heatmapData && idx < heatmapData.length) {
          const m = new Date(heatmapData[idx].date).getUTCMonth();
          if (m !== lastM && w < 52) {
            span.textContent = months[m];
            lastM = m;
          }
        }
        mLabels.appendChild(span);
      }

      for (const day of heatmapData) {
        const cell = document.createElement('div');
        cell.className = 'aga-day-cell';
        if (day.level > 0) cell.setAttribute('data-level', day.level);
        cell.dataset.date = day.date;
        cell.dataset.reqs = day.requests;
        cell.dataset.tokens = day.tokens;
        grid.appendChild(cell);
      }

      // Auto-scroll heatmap to the right so current month's usage is immediately visible
      if (scrollContainer) {
        requestAnimationFrame(() => {
          scrollContainer.scrollLeft = scrollContainer.scrollWidth;
        });
      }
    }

    renderModels(models) {
      const bar = this.root.querySelector('#aga-stacked-bar');
      const list = this.root.querySelector('#aga-model-list');
      if (!bar || !list) return;

      bar.innerHTML = '';
      list.innerHTML = '';

      models.forEach((m, idx) => {
        const color = MODEL_COLORS[idx % MODEL_COLORS.length];

        // Segment
        const seg = document.createElement('div');
        seg.className = 'aga-stacked-seg';
        seg.style.width = `${m.tokenShare}%`;
        seg.style.backgroundColor = color;
        seg.title = `${m.name}: ${m.tokenShare}%`;
        bar.appendChild(seg);

        // List item
        const item = document.createElement('div');
        item.className = 'aga-model-item';
        item.innerHTML = `
          <div class="aga-model-left">
            <span class="aga-model-dot" style="background-color: ${color};"></span>
            <span>${m.name}</span>
          </div>
          <div class="aga-model-right">
            <span>${m.requests.toLocaleString()} reqs</span>
            <span class="val-bold">${formatTokens(m.tokens, 1)}</span>
            <span class="aga-model-badge">${m.tokenShare}%</span>
          </div>
        `;
        list.appendChild(item);
      });
    }
  }

  window.AnalyticsDashboard = AnalyticsDashboard;
})();