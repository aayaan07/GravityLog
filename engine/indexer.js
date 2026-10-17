/**
 * GravityLog - Telemetry & Aggregation Engine
 * Incremental scanner and aggregator for conversation transcripts and SQLite summaries.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

class TelemetryIndexer {
  constructor(options = {}) {
    this.userProfile = process.env.USERPROFILE || os.homedir();
    this.brainDir = options.brainDir || path.join(this.userProfile, '.gemini', 'antigravity', 'brain');
    this.appDataDir = options.appDataDir || path.join(this.userProfile, '.gemini', 'antigravity');
    this.cacheFile = options.cacheFile || path.join(__dirname, 'telemetry_cache.json');
    this.cache = this.loadCache();
  }

  loadCache() {
    try {
      if (fs.existsSync(this.cacheFile)) {
        const data = JSON.parse(fs.readFileSync(this.cacheFile, 'utf8'));
        if (data && data.version === 2) {
          return data;
        }
      }
    } catch (e) {
      console.warn('[TelemetryIndexer] Could not read cache, re-indexing from scratch:', e.message);
    }
    return { version: 2, lastScan: 0, conversations: {} };
  }

  saveCache() {
    try {
      fs.writeFileSync(this.cacheFile, JSON.stringify(this.cache, null, 2), 'utf8');
    } catch (e) {
      console.warn('[TelemetryIndexer] Failed to persist cache:', e.message);
    }
  }

  detectPreferredModel() {
    try {
      const stateFile = path.join(this.appDataDir, 'antigravity_state.pbtxt');
      if (fs.existsSync(stateFile)) {
        const text = fs.readFileSync(stateFile, 'utf8');
        const match = text.match(/last_selected_agent_model:\s*([A-Za-z0-9_]+)/);
        if (match) {
          const raw = match[1];
          if (raw === 'MODEL_PLACEHOLDER_M318') return 'Gemini 3.8 Flash';
          if (raw.includes('FLASH')) return 'Gemini 3.8 Flash';
          if (raw.includes('PRO')) return 'Gemini 3.8 Pro';
          if (raw.includes('CLAUDE')) return 'Claude 3.5 Sonnet';
        }
      }
    } catch (_) {}
    return 'Gemini 3.8 Flash';
  }

  scanIncrementally() {
    if (!fs.existsSync(this.brainDir)) {
      console.warn('[TelemetryIndexer] Brain directory does not exist:', this.brainDir);
      return this.aggregate();
    }

    let folders = [];
    try {
      folders = fs.readdirSync(this.brainDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);
    } catch (err) {
      console.error('[TelemetryIndexer] Error reading brain directory:', err.message);
      return this.aggregate();
    }

    const defaultModel = this.detectPreferredModel();
    let updatedCount = 0;

    for (const convId of folders) {
      const convPath = path.join(this.brainDir, convId);
      const logPath = path.join(convPath, '.system_generated', 'logs', 'transcript.jsonl');
      if (!fs.existsSync(logPath)) continue;

      let stat;
      try {
        stat = fs.statSync(logPath);
      } catch (_) {
        continue;
      }

      const cached = this.cache.conversations[convId];
      if (cached && cached.mtime === stat.mtimeMs && cached.size === stat.size) {
        continue; // Cache is clean
      }

      // Process transcript
      const parsed = this.parseTranscriptFile(logPath, defaultModel);
      this.cache.conversations[convId] = {
        mtime: stat.mtimeMs,
        size: stat.size,
        ...parsed
      };
      updatedCount++;
    }

    if (updatedCount > 0) {
      this.cache.lastScan = Date.now();
      this.saveCache();
    }

    return this.aggregate();
  }

  parseTranscriptFile(logPath, fallbackModel) {
    let requests = 0;
    let userPrompts = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheTokens = 0;
    let thinkingTokens = 0;
    let detectedModel = fallbackModel;

    // Daily breakdown for this conversation: "YYYY-MM-DD" -> { requests, userPrompts, inputTokens, outputTokens, cacheTokens, thinkingTokens, tokens }
    const dailyMap = {};

    try {
      const content = fs.readFileSync(logPath, 'utf8');
      const lines = content.split('\n');

      for (const line of lines) {
        if (!line.trim()) continue;
        let entry;
        try {
          entry = JSON.parse(line);
        } catch (_) {
          continue;
        }

        // Format local calendar date string: YYYY-MM-DD
        let dateStr = '';
        if (entry.created_at) {
          const d = new Date(entry.created_at);
          if (!isNaN(d.getTime())) {
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            dateStr = `${y}-${m}-${day}`;
          }
        }
        if (!dateStr) {
          const d = new Date();
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          dateStr = `${y}-${m}-${day}`;
        }

        if (!dailyMap[dateStr]) {
          dailyMap[dateStr] = {
            requests: 0,
            userPrompts: 0,
            inputTokens: 0,
            outputTokens: 0,
            cacheTokens: 0,
            thinkingTokens: 0,
            tokens: 0
          };
        }

        // Track user prompts
        if (entry.type === 'USER_INPUT' || entry.source === 'USER_EXPLICIT') {
          userPrompts++;
          dailyMap[dateStr].userPrompts = (dailyMap[dateStr].userPrompts || 0) + 1;
        }

        // Extract model identifier
        if (entry.model && typeof entry.model === 'string') {
          detectedModel = this.formatModelName(entry.model);
        } else if (entry.tool_calls) {
          for (const tc of entry.tool_calls) {
            if (tc.name === 'invoke_subagent' && tc.args && tc.args.Subagents) {
              for (const sub of tc.args.Subagents) {
                if (sub.Model && sub.Model !== 'inherit') {
                  detectedModel = this.formatModelName(sub.Model);
                }
              }
            }
          }
        }

        // Extract token usage metrics:
        // Antigravity transcripts store token counts directly at the top level of PLANNER_RESPONSE entries:
        // entry.input_tokens, entry.output_tokens, entry.cache_read_tokens
        let inp = typeof entry.input_tokens === 'number' ? entry.input_tokens : 0;
        let out = typeof entry.output_tokens === 'number' ? entry.output_tokens : 0;
        let cch = typeof entry.cache_read_tokens === 'number' ? entry.cache_read_tokens : 0;
        let thk = typeof entry.thinking_tokens === 'number' ? entry.thinking_tokens : 0;

        if (!thk && typeof entry.thinking === 'string' && entry.thinking.length > 0) {
          thk = Math.max(1, Math.round(entry.thinking.length / 4));
        }

        // Fallback for standard LLM usage metadata wrappers if present
        const usage = entry.usage_metadata || entry.token_usage || entry.usage;
        if (usage) {
          if (!inp) inp = usage.prompt_token_count || usage.input_tokens || usage.prompt_tokens || 0;
          if (!out) out = usage.candidates_token_count || usage.output_tokens || usage.completion_tokens || 0;
          if (!cch) cch = usage.cached_content_token_count || usage.cache_read_input_tokens || 0;
          if (!thk) thk = usage.thinking_token_count || usage.reasoning_tokens || 0;
        }

        // Fallback heuristic estimation if metadata was completely omitted in log
        if (!inp && !out && entry.content && typeof entry.content === 'string') {
          const charCount = entry.content.length;
          const approxTokens = Math.max(1, Math.round(charCount / 4));
          if (entry.type === 'USER_INPUT') {
            inp = approxTokens;
          } else if (entry.type === 'PLANNER_RESPONSE') {
            out = approxTokens;
          }
        }

        // Each PLANNER_RESPONSE represents an LLM API completion request
        if (entry.type === 'PLANNER_RESPONSE' || inp > 0 || out > 0) {
          requests++;
          dailyMap[dateStr].requests++;
        }

        inputTokens += inp;
        outputTokens += out;
        cacheTokens += cch;
        thinkingTokens += thk;

        dailyMap[dateStr].inputTokens += inp;
        dailyMap[dateStr].outputTokens += out;
        dailyMap[dateStr].cacheTokens = (dailyMap[dateStr].cacheTokens || 0) + cch;
        dailyMap[dateStr].thinkingTokens += thk;
        dailyMap[dateStr].tokens += (inp + out);
      }

      // If a transcript had user inputs but no completed planner response yet, record at least the prompt request
      if (requests === 0 && userPrompts > 0) {
        requests = userPrompts;
        const firstDate = Object.keys(dailyMap)[0] || new Date().toISOString().split('T')[0];
        if (dailyMap[firstDate]) {
          dailyMap[firstDate].requests = userPrompts;
        }
      }
    } catch (err) {
      console.warn(`[TelemetryIndexer] Error parsing transcript ${logPath}:`, err.message);
    }

    return {
      requests,
      userPrompts,
      inputTokens,
      outputTokens,
      cacheTokens,
      thinkingTokens,
      model: detectedModel,
      daily: dailyMap
    };
  }

  formatModelName(raw) {
    if (!raw) return 'Gemini 3.8 Flash';
    const s = String(raw).toLowerCase();
    if (s.includes('flash') || s.includes('m318')) return 'Gemini 3.8 Flash';
    if (s.includes('pro')) return 'Gemini 3.8 Pro';
    if (s.includes('sonnet') && s.includes('3.7')) return 'Claude 3.7 Sonnet';
    if (s.includes('sonnet') || s.includes('claude')) return 'Claude 3.5 Sonnet';
    if (s.includes('gpt-4o')) return 'GPT-4o';
    return raw;
  }

  aggregate(timeframe = 'all') {
    let totalRequests = 0;
    let totalUserPrompts = 0;
    let requestsToday = 0;
    let requests30d = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCacheTokens = 0;
    let totalThinkingTokens = 0;

    const filteredDailyBuckets = {}; // Daily buckets filtered by timeframe
    const allDailyBuckets = {};      // Full year daily buckets for 365-day heatmap
    const modelStats = {};          // modelName -> { requests, tokens, inputTokens, outputTokens }

    const now = new Date();
    const nowMs = now.getTime();
    // Midnight of today in local time
    const todayMidnightMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    // 1 week: 7 days (today + previous 6 days)
    const ms1wAgo = todayMidnightMs - (6 * 24 * 60 * 60 * 1000);
    // 30 days
    const ms30dAgo = nowMs - (30 * 24 * 60 * 60 * 1000);
    // 90 days
    const ms90dAgo = nowMs - (90 * 24 * 60 * 60 * 1000);

    let isIncluded = () => true;
    if (timeframe === 'today') {
      isIncluded = (dMs) => dMs >= todayMidnightMs;
    } else if (timeframe === '1w') {
      isIncluded = (dMs) => dMs >= ms1wAgo;
    } else if (timeframe === '30d') {
      isIncluded = (dMs) => dMs >= ms30dAgo;
    } else if (timeframe === '90d') {
      isIncluded = (dMs) => dMs >= ms90dAgo;
    }

    for (const [convId, data] of Object.entries(this.cache.conversations)) {
      const model = data.model || 'Gemini 3.8 Flash';
      if (!modelStats[model]) {
        modelStats[model] = { requests: 0, tokens: 0, inputTokens: 0, outputTokens: 0 };
      }

      // Check daily entries
      for (const [dateStr, dayData] of Object.entries(data.daily || {})) {
        const [y, m, d] = dateStr.split('-').map(Number);
        const dMs = new Date(y, m - 1, d, 12, 0, 0).getTime();

        // Accumulate full year for heatmap calendar
        if (!allDailyBuckets[dateStr]) {
          allDailyBuckets[dateStr] = {
            requests: 0,
            tokens: 0,
            inputTokens: 0,
            outputTokens: 0,
            cacheTokens: 0,
            thinkingTokens: 0
          };
        }
        allDailyBuckets[dateStr].requests += dayData.requests || 0;
        allDailyBuckets[dateStr].tokens += dayData.tokens || 0;
        allDailyBuckets[dateStr].inputTokens += dayData.inputTokens || 0;
        allDailyBuckets[dateStr].outputTokens += dayData.outputTokens || 0;
        allDailyBuckets[dateStr].cacheTokens += dayData.cacheTokens || 0;
        allDailyBuckets[dateStr].thinkingTokens += dayData.thinkingTokens || 0;

        // KPI Badges (always computed relative to today/30d regardless of timeframe filter)
        if (dMs >= todayMidnightMs) {
          requestsToday += dayData.requests || 0;
        }
        if (dMs >= ms30dAgo) {
          requests30d += dayData.requests || 0;
        }

        // Apply timeframe filter for KPIs and Model breakdown
        if (isIncluded(dMs)) {
          if (!filteredDailyBuckets[dateStr]) {
            filteredDailyBuckets[dateStr] = {
              requests: 0,
              tokens: 0,
              inputTokens: 0,
              outputTokens: 0,
              cacheTokens: 0,
              thinkingTokens: 0
            };
          }

          filteredDailyBuckets[dateStr].requests += dayData.requests || 0;
          filteredDailyBuckets[dateStr].tokens += dayData.tokens || 0;
          filteredDailyBuckets[dateStr].inputTokens += dayData.inputTokens || 0;
          filteredDailyBuckets[dateStr].outputTokens += dayData.outputTokens || 0;
          filteredDailyBuckets[dateStr].cacheTokens += dayData.cacheTokens || 0;
          filteredDailyBuckets[dateStr].thinkingTokens += dayData.thinkingTokens || 0;

          totalRequests += dayData.requests || 0;
          totalUserPrompts += dayData.userPrompts || 0;
          totalInputTokens += dayData.inputTokens || 0;
          totalOutputTokens += dayData.outputTokens || 0;
          totalCacheTokens += dayData.cacheTokens || 0;
          totalThinkingTokens += dayData.thinkingTokens || 0;

          modelStats[model].requests += dayData.requests || 0;
          modelStats[model].tokens += dayData.tokens || 0;
          modelStats[model].inputTokens += dayData.inputTokens || 0;
          modelStats[model].outputTokens += dayData.outputTokens || 0;
        }
      }
    }

    const totalTokens = totalInputTokens + totalOutputTokens;

    // Calculate model ranking and percentage share
    const modelsList = Object.entries(modelStats)
      .map(([name, stat]) => ({
        name,
        requests: stat.requests,
        tokens: stat.tokens,
        inputTokens: stat.inputTokens,
        outputTokens: stat.outputTokens,
        requestShare: totalRequests > 0 ? Number(((stat.requests / totalRequests) * 100).toFixed(1)) : 0,
        tokenShare: totalTokens > 0 ? Number(((stat.tokens / totalTokens) * 100).toFixed(1)) : 0
      }))
      .filter(m => m.requests > 0 || m.tokens > 0)
      .sort((a, b) => b.tokens - a.tokens);

    // Heatmap calculation (365 days) from all daily buckets
    const heatmap = this.generateHeatmapMatrix(allDailyBuckets, now);

    return {
      synced: true,
      lastUpdated: new Date().toISOString(),
      timeframe,
      totals: {
        requests: totalRequests,
        userPrompts: totalUserPrompts,
        requestsToday,
        requests30d,
        tokens: totalTokens,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        cacheTokens: totalCacheTokens,
        thinkingTokens: totalThinkingTokens
      },
      mostUsedModel: modelsList.length > 0 ? {
        name: modelsList[0].name,
        share: modelsList[0].tokenShare
      } : { name: 'Gemini 3.8 Flash', share: 100 },
      models: modelsList,
      heatmap: heatmap.matrix,
      streaks: heatmap.streaks,
      activeDaysCount: Object.keys(filteredDailyBuckets).length
    };
  }

  generateHeatmapMatrix(dailyBuckets, referenceDate = new Date()) {
    const daysList = [];
    const oneDayMs = 24 * 60 * 60 * 1000;

    // Find the closest preceding Sunday for 52-53 clean weeks
    const refDayOfWeek = referenceDate.getUTCDay(); // 0 is Sunday
    const endSunday = new Date(referenceDate.getTime() + ((7 - refDayOfWeek) % 7) * oneDayMs);

    // 53 weeks = 371 days
    const totalDays = 53 * 7;
    const startSunday = new Date(endSunday.getTime() - (totalDays - 1) * oneDayMs);

    for (let i = 0; i < totalDays; i++) {
      const currentDay = new Date(startSunday.getTime() + i * oneDayMs);
      const dateStr = currentDay.toISOString().split('T')[0];
      const entry = dailyBuckets[dateStr] || { requests: 0, tokens: 0, inputTokens: 0, outputTokens: 0 };

      daysList.push({
        date: dateStr,
        dayOfWeek: currentDay.getUTCDay(),
        requests: entry.requests,
        tokens: entry.tokens,
        inputTokens: entry.inputTokens,
        outputTokens: entry.outputTokens,
        level: 0 // Will assign 0-4
      });
    }

    // Assign intensity levels 0-4
    const activeDays = daysList.filter(d => d.tokens > 0).map(d => d.tokens);
    activeDays.sort((a, b) => a - b);

    let q1 = 1, q2 = 10000, q3 = 50000;
    if (activeDays.length >= 4) {
      q1 = activeDays[Math.floor(activeDays.length * 0.25)];
      q2 = activeDays[Math.floor(activeDays.length * 0.50)];
      q3 = activeDays[Math.floor(activeDays.length * 0.75)];
    }

    daysList.forEach(d => {
      if (d.tokens === 0 && d.requests === 0) {
        d.level = 0;
      } else if (d.tokens <= q1) {
        d.level = 1;
      } else if (d.tokens <= q2) {
        d.level = 2;
      } else if (d.tokens <= q3) {
        d.level = 3;
      } else {
        d.level = 4;
      }
    });

    // Compute streaks
    const streaks = this.calculateStreaks(daysList);

    return { matrix: daysList, streaks };
  }

  calculateStreaks(daysList) {
    let currentStreak = 0;
    let longestStreak = 0;
    let tempStreak = 0;

    // Sort chronologically
    const sorted = [...daysList].sort((a, b) => a.date.localeCompare(b.date));

    for (let i = 0; i < sorted.length; i++) {
      const d = sorted[i];
      if (d.requests > 0 || d.tokens > 0) {
        tempStreak++;
        if (tempStreak > longestStreak) {
          longestStreak = tempStreak;
        }
      } else {
        tempStreak = 0;
      }
    }

    // Current streak ending today or yesterday
    const todayStr = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

    let checkIdx = sorted.findIndex(d => d.date === todayStr);
    if (checkIdx === -1 || (sorted[checkIdx].requests === 0 && sorted[checkIdx].tokens === 0)) {
      checkIdx = sorted.findIndex(d => d.date === yesterday);
    }

    if (checkIdx !== -1 && (sorted[checkIdx].requests > 0 || sorted[checkIdx].tokens > 0)) {
      let count = 0;
      for (let i = checkIdx; i >= 0; i--) {
        if (sorted[i].requests > 0 || sorted[i].tokens > 0) {
          count++;
        } else {
          break;
        }
      }
      currentStreak = count;
    }

    return { current: currentStreak, longest: longestStreak };
  }

  getPreviewData(timeframe = 'all') {
    // Generate realistic seeded data for 365 days matching reference design
    const now = new Date();
    const dailyBuckets = {};

    for (let i = 365; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86400000);
      const dateStr = d.toISOString().split('T')[0];
      const dayOfWeek = d.getUTCDay();

      const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
      const prob = isWeekend ? 0.45 : 0.85;

      if (Math.random() < prob) {
        const reqs = isWeekend 
          ? Math.floor(Math.random() * 8) + 1 
          : Math.floor(Math.random() * 25) + 3;
        const inp = reqs * (Math.floor(Math.random() * 35000) + 12000);
        const out = reqs * (Math.floor(Math.random() * 3200) + 900);
        const think = reqs * (Math.floor(Math.random() * 1200) + 300);

        dailyBuckets[dateStr] = {
          requests: reqs,
          tokens: inp + out,
          inputTokens: inp,
          outputTokens: out,
          thinkingTokens: think
        };
      }
    }

    const heatmap = this.generateHeatmapMatrix(dailyBuckets, now);

    let totals = {
      requests: 3614,
      userPrompts: 48,
      requestsToday: 14,
      requests30d: 795,
      tokens: 115100000,
      inputTokens: 105800000,
      outputTokens: 9300000,
      cacheTokens: 184000000,
      thinkingTokens: 1420000,
    };

    if (timeframe === 'today') {
      totals = {
        requests: 14,
        userPrompts: 2,
        requestsToday: 14,
        requests30d: 795,
        tokens: 448000,
        inputTokens: 412000,
        outputTokens: 36000,
        cacheTokens: 720000,
        thinkingTokens: 5500,
      };
    } else if (timeframe === '1w') {
      totals = {
        requests: 186,
        userPrompts: 12,
        requestsToday: 14,
        requests30d: 795,
        tokens: 5950000,
        inputTokens: 5470000,
        outputTokens: 480000,
        cacheTokens: 9500000,
        thinkingTokens: 74000,
      };
    } else if (timeframe === '30d') {
      totals = {
        requests: 795,
        userPrompts: 26,
        requestsToday: 14,
        requests30d: 795,
        tokens: 25300000,
        inputTokens: 23250000,
        outputTokens: 2050000,
        cacheTokens: 40500000,
        thinkingTokens: 312000,
      };
    } else if (timeframe === '90d') {
      totals = {
        requests: 1980,
        userPrompts: 35,
        requestsToday: 14,
        requests30d: 795,
        tokens: 63000000,
        inputTokens: 57900000,
        outputTokens: 5100000,
        cacheTokens: 101000000,
        thinkingTokens: 780000,
      };
    }

    return {
      synced: true,
      isPreview: true,
      lastUpdated: new Date().toISOString(),
      timeframe,
      totals,
      mostUsedModel: { name: 'Gemini 3.8 Flash', share: 64.2 },
      models: [
        {
          name: 'Gemini 3.8 Flash',
          requests: Math.round(totals.requests * 0.65),
          tokens: Math.round(totals.tokens * 0.642),
          inputTokens: Math.round(totals.inputTokens * 0.642),
          outputTokens: Math.round(totals.outputTokens * 0.642),
          requestShare: 65.0,
          tokenShare: 64.2
        },
        {
          name: 'Gemini 3.8 Pro',
          requests: Math.round(totals.requests * 0.23),
          tokens: Math.round(totals.tokens * 0.245),
          inputTokens: Math.round(totals.inputTokens * 0.245),
          outputTokens: Math.round(totals.outputTokens * 0.245),
          requestShare: 23.0,
          tokenShare: 24.5
        },
        {
          name: 'Claude 3.7 Sonnet',
          requests: Math.round(totals.requests * 0.12),
          tokens: Math.round(totals.tokens * 0.113),
          inputTokens: Math.round(totals.inputTokens * 0.113),
          outputTokens: Math.round(totals.outputTokens * 0.113),
          requestShare: 12.0,
          tokenShare: 11.3
        }
      ],
      heatmap: heatmap.matrix,
      streaks: { current: 14, longest: 28 },
      activeDaysCount: Object.keys(dailyBuckets).length
    };
  }
}

module.exports = TelemetryIndexer;
