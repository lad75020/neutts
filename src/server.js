import { randomUUID } from "node:crypto";

import Fastify from "fastify";
import sensible from "@fastify/sensible";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import { buildMcpServer } from "./mcp.js";

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";
const MCP_PATH = process.env.MCP_PATH ?? "/mcp";
const BODY_LIMIT_BYTES = Number(process.env.BODY_LIMIT_BYTES ?? 64 * 1024 * 1024);

const fastify = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? "info" },
  bodyLimit: BODY_LIMIT_BYTES,
});

await fastify.register(sensible);

const transports = new Map();

async function createSession(log) {
  let transport;
  transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (sessionId) => {
      transports.set(sessionId, transport);
      log.info({ sessionId }, "mcp session initialized");
    },
  });

  transport.onclose = () => {
    if (transport.sessionId) {
      transports.delete(transport.sessionId);
      log.info({ sessionId: transport.sessionId }, "mcp session closed");
    }
  };

  const mcp = buildMcpServer({ log });
  await mcp.connect(transport);
  return transport;
}

function getSessionIdHeader(req) {
  const raw = req.headers["mcp-session-id"];
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

async function handleMcp(req, reply) {
  const sessionId = getSessionIdHeader(req);
  let transport = sessionId ? transports.get(sessionId) : undefined;

  if (!transport) {
    if (req.method === "POST" && isInitializeRequest(req.body)) {
      transport = await createSession(req.log);
    } else {
      reply.code(400);
      return {
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Bad Request: no valid MCP session. Send an initialize request first.",
        },
        id: null,
      };
    }
  }

  reply.hijack();
  try {
    await transport.handleRequest(req.raw, reply.raw, req.body);
  } catch (err) {
    req.log.error({ err }, "mcp transport error");
    if (!reply.raw.headersSent) {
      reply.raw.writeHead(500, { "content-type": "application/json" });
      reply.raw.end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        }),
      );
    } else {
      reply.raw.end();
    }
  }
}

fastify.route({
  method: ["POST", "GET", "DELETE"],
  url: MCP_PATH,
  handler: handleMcp,
});

fastify.get("/healthz", async () => ({ ok: true }));

async function shutdown(signal) {
  fastify.log.info({ signal }, "shutting down");
  for (const transport of transports.values()) {
    try {
      await transport.close();
    } catch (err) {
      fastify.log.warn({ err }, "error closing transport");
    }
  }
  transports.clear();
  await fastify.close();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

try {
  await fastify.listen({ port: PORT, host: HOST });
  fastify.log.info(`MCP endpoint: http://${HOST}:${PORT}${MCP_PATH}`);
} catch (err) {
  fastify.log.error({ err }, "failed to start server");
  process.exit(1);
}
