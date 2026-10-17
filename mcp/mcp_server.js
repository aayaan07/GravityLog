#!/usr/bin/env node
/**
 * GravityLog - Model Context Protocol (MCP) Server
 * Stdio Transport implementation for Antigravity & LLM tooling.
 */

const readline = require('readline');
const TelemetryIndexer = require('../engine/indexer');

const indexer = new TelemetryIndexer();

const TOOLS = [
  {
    name: 'get_usage_metrics',
    description: 'Retrieve aggregate usage metrics for Antigravity (total requests, token breakdown by input/output/thinking, active streaks, and top model).',
    inputSchema: {
      type: 'object',
      properties: {
        timeframe: {
          type: 'string',
          enum: ['today', '1w', '30d', '90d', 'all'],
          description: 'Timeframe filter for metrics calculation. Defaults to "all".'
        },
        preview: {
          type: 'boolean',
          description: 'If true, returns seeded preview data instead of local logs.'
        }
      }
    }
  },
  {
    name: 'get_activity_heatmap',
    description: 'Retrieve the 365-day GitHub-style activity matrix with daily request counts, token volumes, and intensity levels (0-4).',
    inputSchema: {
      type: 'object',
      properties: {
        preview: {
          type: 'boolean',
          description: 'If true, returns seeded preview data.'
        }
      }
    }
  },
  {
    name: 'get_model_breakdown',
    description: 'Retrieve ranked list of AI models used by token consumption and request count with percentage shares.',
    inputSchema: {
      type: 'object',
      properties: {
        preview: {
          type: 'boolean',
          description: 'If true, returns seeded preview data.'
        }
      }
    }
  },
  {
    name: 'export_telemetry',
    description: 'Export telemetry data as a formatted JSON or CSV string.',
    inputSchema: {
      type: 'object',
      properties: {
        format: {
          type: 'string',
          enum: ['json', 'csv'],
          description: 'Export format: "json" or "csv".'
        },
        preview: {
          type: 'boolean',
          description: 'If true, exports preview sample data.'
        }
      },
      required: ['format']
    }
  }
];

function handleToolCall(name, args = {}) {
  const isPreview = Boolean(args.preview);
  const data = isPreview ? indexer.getPreviewData() : indexer.scanIncrementally();

  switch (name) {
    case 'get_usage_metrics': {
      const timeframe = args.timeframe || 'all';
      const filtered = isPreview ? data : indexer.aggregate(timeframe);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              timeframe: filtered.timeframe,
              totals: filtered.totals,
              mostUsedModel: filtered.mostUsedModel,
              streaks: filtered.streaks,
              activeDays: filtered.activeDaysCount
            }, null, 2)
          }
        ]
      };
    }

    case 'get_activity_heatmap': {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              totalDays: data.heatmap.length,
              streaks: data.streaks,
              heatmap: data.heatmap
            }, null, 2)
          }
        ]
      };
    }

    case 'get_model_breakdown': {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              mostUsedModel: data.mostUsedModel,
              models: data.models
            }, null, 2)
          }
        ]
      };
    }

    case 'export_telemetry': {
      const format = (args.format || 'json').toLowerCase();
      if (format === 'csv') {
        let csv = 'Date,Requests,Tokens,InputTokens,OutputTokens,IntensityLevel\n';
        for (const d of data.heatmap) {
          csv += `${d.date},${d.requests},${d.tokens},${d.inputTokens},${d.outputTokens},${d.level}\n`;
        }
        return {
          content: [
            {
              type: 'text',
              text: csv
            }
          ]
        };
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(data, null, 2)
          }
        ]
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// JSON-RPC 2.0 stdio loop
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('line', (line) => {
  if (!line.trim()) return;
  try {
    const request = JSON.parse(line);
    const { id, method, params } = request;

    if (method === 'initialize') {
      const response = {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: {
            name: 'gravitylog-analytics',
            version: '1.0.0'
          }
        }
      };
      process.stdout.write(JSON.stringify(response) + '\n');
      return;
    }

    if (method === 'notifications/initialized') {
      return;
    }

    if (method === 'tools/list') {
      const response = {
        jsonrpc: '2.0',
        id,
        result: { tools: TOOLS }
      };
      process.stdout.write(JSON.stringify(response) + '\n');
      return;
    }

    if (method === 'tools/call') {
      const { name, arguments: args } = params;
      try {
        const result = handleToolCall(name, args);
        const response = {
          jsonrpc: '2.0',
          id,
          result
        };
        process.stdout.write(JSON.stringify(response) + '\n');
      } catch (err) {
        const response = {
          jsonrpc: '2.0',
          id,
          error: { code: -32000, message: err.message }
        };
        process.stdout.write(JSON.stringify(response) + '\n');
      }
      return;
    }

    if (method === 'ping') {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result: {} }) + '\n');
      return;
    }

    // Default method not found
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${method}` }
    }) + '\n');

  } catch (err) {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: `Parse error: ${err.message}` }
    }) + '\n');
  }
});
