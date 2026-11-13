import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const projectRoot = dirname(fileURLToPath(import.meta.url));
// CLI bundling needs workspace root so tracing includes hoisted node_modules (slim ~50MB).
// Docker / default uses projectRoot so server.js lands at /app/server.js (not nested).
const tracingRoot = process.env.NEXT_TRACING_ROOT_MODE === "workspace"
  ? join(projectRoot, "..")
  : projectRoot;
// The per-request body ceiling for /v1 and /api. Next buffers every non-GET
// request body into RAM up to this size BEFORE the handler runs (and the proxy
// that matches this path reads no body at all), so this number is the dominant
// per-request memory cost, multiplied by concurrency. 128mb let two concurrent
// requests hold a quarter of a gigabyte for nothing; 32mb still clears a
// million-token context with room for base64 images. Raise it per deployment
// with VELA_PROXY_CLIENT_MAX_BODY_SIZE if a workload genuinely needs more.
const proxyClientMaxBodySize = process.env.VELA_PROXY_CLIENT_MAX_BODY_SIZE || "32mb";

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  output: "standalone",
  // The headroom sidecar (vela-headroom) compresses upstream traffic; the
  // built-in gzip would double-compress and waste CPU. Fail-open if the
  // sidecar is absent.
  compress: false,
  poweredByHeader: false,
  // `open` must stay external. It derives its own directory from `import.meta.url`, and
  // webpack replaces that with the absolute path of the BUILD machine as a string literal.
  // A release built on macOS therefore ships `file:///Users/.../open/index.js`, which
  // `fileURLToPath` rejects on Windows ("File URL path must be absolute" — no drive
  // letter). That throw happens at module scope, so every consumer of `open` dies on
  // import — including xAI/Grok token refresh, which loads the OAuth service that imports
  // it. Keeping it external preserves the real `import.meta.url` at runtime.
  // `@aws-sdk/credential-providers` must stay external too: it reads ~/.aws/config and
  // the SSO token cache from disk at runtime and resolves its credential plugins by
  // dynamic require, neither of which survives bundling. `wreq-js` resolves its rust
  // native binding by relative require paths from its own package dir — bundling breaks
  // those paths ("Failed to load native module"). `undici` must stay external as well:
  // webpack's vendored copy drops the per-request `dispatcher` connect options — the
  // built server then RSTs on DPI-shaped networks while the dev server (real undici)
  // passes. `uuid` stays external for the same import.meta.url class of reason.
  serverExternalPackages: ["better-sqlite3", "sql.js", "node:sqlite", "bun:sqlite", "open", "uuid", "@aws-sdk/credential-providers", "wreq-js", "undici"],
  turbopack: {
    root: tracingRoot
  },
  outputFileTracingRoot: tracingRoot,
  // serverExternalPackages keeps undici external; the lazy dynamic import("undici")
  // in proxyFetch doesn't pull it into the trace by itself, so force-ship the package.
  outputFileTracingIncludes: {
    "*": ["./node_modules/undici/**/*"]
  },
  outputFileTracingExcludes: {
    "*": ["./gitbook/**/*"]
  },
  images: {
    unoptimized: true
  },
  // The dashboard is browsed via the homelab LAN / Tailscale IP — allow those
  // origins to load dev HMR + static assets (blocked by default since Next 15.5).
  allowedDevOrigins: ["192.168.18.248", "192.168.18.190", "100.95.77.63", "100.100.40.48"],
  env: {},
  experimental: {
    // #1529/#1572: LLM clients can send long context or base64 image payloads through /v1 rewrites.
    proxyClientMaxBodySize,
    // Cache fetch responses across HMR refreshes for faster dev reloads.
    serverComponentsHmrCache: true,
    // Tree-shake heavy barrel imports to cut compile + bundle size
    optimizePackageImports: ["@xyflow/react", "@dnd-kit/core", "@dnd-kit/sortable", "material-symbols", "marked"],
  },
  webpack: (config, { isServer }) => {
    // Ignore fs/path modules in browser bundle
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
      };
    }
    // Exclude non-source dirs from watcher to reduce inotify load
    config.watchOptions = {
      ...config.watchOptions,
      aggregateTimeout: 300,
      ignored: /[\\/](node_modules|\.git|logs|\.next|\.next-cli-build|gitbook|cli|open-sse\.old|tests|docs)[\\/]/,
    };
    return config;
  },
  async rewrites() {
    return [
      {
        source: "/v1/v1/:path*",
        destination: "/api/v1/:path*"
      },
      {
        source: "/v1/v1",
        destination: "/api/v1"
      },
      {
        source: "/codex/:path*",
        destination: "/api/v1/responses"
      },
      {
        source: "/responses",
        destination: "/api/v1/responses"
      },
      {
        source: "/systemone",
        destination: "/api/v1/systemone"
      },
      {
        source: "/v1beta/:path*",
        destination: "/api/v1beta/:path*"
      },
      {
        source: "/v1beta",
        destination: "/api/v1beta"
      },
      {
        source: "/v1/:path*",
        destination: "/api/v1/:path*"
      },
      {
        source: "/v1",
        destination: "/api/v1"
      }
    ];
  },
  async redirects() {
    return [];
  }
};

export default nextConfig;
