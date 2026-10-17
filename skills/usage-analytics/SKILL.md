---
name: usage-analytics
description: Inspect and display Antigravity 2.0 usage statistics, prompt request counts, token consumption breakdowns, model distribution, and 365-day GitHub-style contribution heatmaps with GravityLog.
---

# GravityLog - Antigravity Usage Tracker

GravityLog provides clean, minimal, Google-styled usage analytics and telemetry for Antigravity 2.0.

## Quick Actions

- **Right Sidebar Window**: Open GravityLog directly from the Antigravity sidebar extension pane, or click [GravityLog](sidecar://antigravity-analytics/usage-analytics/).
- **Direct Web Access**: Open `http://localhost:49221` in your browser.

## Available MCP Tools

When the plugin is active, you have access to the following tools:

1. `usage-analytics__get_usage_metrics`:
   - Returns lifetime, 30-day, and today's prompt counts.
   - Returns token breakdowns (input, output, cache read, thinking tokens).
   - Returns current and longest daily active streaks.
   - Supports `timeframe: "today" | "1w" | "30d" | "90d" | "all"` and `preview: boolean`.

2. `usage-analytics__get_activity_heatmap`:
   - Returns 365-day contribution matrix mapping daily buckets to intensity levels (0 to 4).

3. `usage-analytics__get_model_breakdown`:
   - Returns ranked AI models with percentage shares of tokens and runs.

4. `usage-analytics__export_telemetry`:
   - Exports data as JSON or CSV.
