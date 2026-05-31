import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildStatusBarArgs,
  formatDeviceList,
  resolveDevice,
  xcrun,
  type Runner,
  type StatusBarOptions,
} from "./simctl.js";

// ---------------------------------------------------------------------------
// Dependencies (injectable for testing)
// ---------------------------------------------------------------------------

export interface ServerDeps {
  /** Runs an `xcrun` subcommand. Defaults to the real runner. */
  run?: Runner;
  /** Brings the Simulator app to the foreground (used by `boot`). */
  openApp?: () => void;
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const DEVICE_PROP = {
  device: {
    type: "string",
    description: 'Device name, UDID, or "booted" (default)',
    default: "booted",
  },
} as const;

export const TOOLS = [
  // ── Visual ──────────────────────────────────────────────────────────────
  {
    name: "screenshot",
    description:
      "Capture a screenshot of the booted iOS Simulator. " +
      "Returns the image as base64 PNG so you can visually inspect the UI. " +
      "Use this after navigating or tapping to see the current state.",
    inputSchema: {
      type: "object",
      properties: { ...DEVICE_PROP },
    },
  },

  // ── Navigation ───────────────────────────────────────────────────────────
  {
    name: "open_url",
    description:
      "Open a URL in Safari on the booted iOS Simulator. " +
      "Use http://localhost:3000 to preview the local dev server. " +
      "Also works with custom app URL schemes for deep-linking.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to open" },
        ...DEVICE_PROP,
      },
      required: ["url"],
    },
  },

  // ── Touch ────────────────────────────────────────────────────────────────
  {
    name: "tap",
    description:
      "Simulate a finger tap at (x, y) coordinates on the booted Simulator screen. " +
      "Take a screenshot first to find the coordinates you want to tap.",
    inputSchema: {
      type: "object",
      properties: {
        x: { type: "number", description: "X coordinate in points" },
        y: { type: "number", description: "Y coordinate in points" },
        ...DEVICE_PROP,
      },
      required: ["x", "y"],
    },
  },
  {
    name: "swipe",
    description:
      "Simulate a swipe gesture on the booted Simulator. " +
      "Use to scroll: swipe from (centerX, bottom) to (centerX, top) to scroll down.",
    inputSchema: {
      type: "object",
      properties: {
        x1: { type: "number", description: "Start X" },
        y1: { type: "number", description: "Start Y" },
        x2: { type: "number", description: "End X" },
        y2: { type: "number", description: "End Y" },
        duration: {
          type: "number",
          description: "Gesture duration in milliseconds (default 500)",
          default: 500,
        },
        ...DEVICE_PROP,
      },
      required: ["x1", "y1", "x2", "y2"],
    },
  },

  // ── Appearance ───────────────────────────────────────────────────────────
  {
    name: "set_appearance",
    description: "Switch the booted Simulator between light and dark mode.",
    inputSchema: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: ["light", "dark"],
          description: "Appearance mode",
        },
        ...DEVICE_PROP,
      },
      required: ["mode"],
    },
  },
  {
    name: "set_status_bar",
    description:
      "Override the status bar on the booted Simulator for clean screenshots " +
      "(e.g. set time to 9:41, full battery). Pass clear: true to reset.",
    inputSchema: {
      type: "object",
      properties: {
        time: { type: "string", description: 'Display time, e.g. "9:41"' },
        batteryLevel: { type: "number", description: "Battery level 0–100" },
        batteryState: {
          type: "string",
          enum: ["charging", "charged", "discharging"],
        },
        wifiMode: {
          type: "string",
          enum: ["searching", "failed", "active"],
        },
        wifiBars: { type: "number", minimum: 0, maximum: 3 },
        cellMode: {
          type: "string",
          enum: ["notSupported", "searching", "failed", "active"],
        },
        cellBars: { type: "number", minimum: 0, maximum: 4 },
        clear: {
          type: "boolean",
          description: "Clear all status bar overrides",
        },
        ...DEVICE_PROP,
      },
    },
  },

  // ── Device management ────────────────────────────────────────────────────
  {
    name: "list_devices",
    description:
      "List all available iOS Simulator devices with their state (Booted / Shutdown).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "boot",
    description:
      "Boot an iOS Simulator device by name or UDID and open the Simulator app.",
    inputSchema: {
      type: "object",
      properties: {
        device: {
          type: "string",
          description: 'Device name or UDID, e.g. "iPhone 16 Pro"',
        },
      },
      required: ["device"],
    },
  },
  {
    name: "shutdown",
    description: "Shutdown an iOS Simulator device.",
    inputSchema: {
      type: "object",
      properties: { ...DEVICE_PROP },
    },
  },
];

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

/**
 * Builds the iOS Simulator MCP server. Pass `deps` to inject a fake command
 * runner (and Simulator-app opener) in tests; the defaults shell out for real.
 */
export function createServer(deps: ServerDeps = {}): Server {
  const run = deps.run ?? xcrun;
  const openApp =
    deps.openApp ??
    (() => {
      execFileSync("open", ["-a", "Simulator"], { stdio: "ignore" });
    });

  const server = new Server(
    { name: "ios-simulator", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  const device = (args: Record<string, unknown>): string =>
    resolveDevice(run, (args.device as string | undefined) ?? "booted");

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;

    try {
      switch (name) {
        case "screenshot": {
          const dev = device(args);
          const file = join(tmpdir(), `sim-${Date.now()}.png`);
          try {
            run(["simctl", "io", dev, "screenshot", file]);
            const base64 = readFileSync(file).toString("base64");
            return {
              content: [{ type: "image", data: base64, mimeType: "image/png" }],
            };
          } finally {
            if (existsSync(file)) unlinkSync(file);
          }
        }

        case "open_url": {
          const dev = device(args);
          const url = args.url as string;
          run(["simctl", "openurl", dev, url]);
          return { content: [{ type: "text", text: `Opened: ${url}` }] };
        }

        case "tap": {
          const dev = device(args);
          const x = args.x as number;
          const y = args.y as number;
          run(["simctl", "io", dev, "tap", String(x), String(y)]);
          return { content: [{ type: "text", text: `Tapped (${x}, ${y})` }] };
        }

        case "swipe": {
          const dev = device(args);
          const {
            x1,
            y1,
            x2,
            y2,
            duration = 500,
          } = args as {
            x1: number;
            y1: number;
            x2: number;
            y2: number;
            duration?: number;
          };
          run([
            "simctl",
            "io",
            dev,
            "swipe",
            String(x1),
            String(y1),
            String(x2),
            String(y2),
            String(duration),
          ]);
          return {
            content: [
              {
                type: "text",
                text: `Swiped (${x1},${y1}) → (${x2},${y2}) over ${duration}ms`,
              },
            ],
          };
        }

        case "set_appearance": {
          const dev = device(args);
          const mode = args.mode as string;
          run(["simctl", "ui", dev, "appearance", mode]);
          return {
            content: [{ type: "text", text: `Appearance set to ${mode}` }],
          };
        }

        case "set_status_bar": {
          const dev = device(args);
          run(buildStatusBarArgs(dev, args as StatusBarOptions));
          const text = args.clear
            ? "Status bar overrides cleared"
            : "Status bar updated";
          return { content: [{ type: "text", text }] };
        }

        case "list_devices": {
          const raw = run(["simctl", "list", "devices", "--json"]);
          return { content: [{ type: "text", text: formatDeviceList(raw) }] };
        }

        case "boot": {
          const udid = resolveDevice(run, args.device as string);
          run(["simctl", "boot", udid]);
          openApp();
          return {
            content: [
              {
                type: "text",
                text: `Booted: ${args.device as string} (${udid})`,
              },
            ],
          };
        }

        case "shutdown": {
          const dev = device(args);
          run(["simctl", "shutdown", dev]);
          return { content: [{ type: "text", text: `Shutdown: ${dev}` }] };
        }

        default:
          return {
            content: [{ type: "text", text: `Unknown tool: ${name}` }],
            isError: true,
          };
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  return server;
}
