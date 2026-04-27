// neutts-client.mjs
import { readFile, writeFile } from 'node:fs/promises';

const PROTOCOL_VERSION = '2025-06-18';

export class MCPClient {
  constructor(url) {
    this.url = url;
    this.sessionId = null;
    this.nextId = 1;
  }

  async #post(body, { expectStream = false } = {}) {
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'MCP-Protocol-Version': PROTOCOL_VERSION,
    };
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;

    const res = await fetch(this.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    // Capture session id on initialize response
    const sid = res.headers.get('mcp-session-id');
    if (sid) this.sessionId = sid;

    if (res.status === 202) return null; // notification ack

    const ct = res.headers.get('content-type') || '';
    const text = await res.text();

    if (ct.includes('text/event-stream')) {
      // Single-shot SSE: take the last `data:` JSON payload
      const last = text
        .split(/\r?\n/)
        .filter(l => l.startsWith('data: '))
        .map(l => l.slice(6))
        .pop();
      if (!last) throw new Error(`Empty SSE response: ${text}`);
      return JSON.parse(last);
    }
    if (ct.includes('application/json')) return JSON.parse(text);
    throw new Error(`Unexpected content-type ${ct}: ${text}`);
  }

  async #request(method, params) {
    const id = this.nextId++;
    const resp = await this.#post({ jsonrpc: '2.0', id, method, params });
    if (resp.error) throw new Error(`${method} failed: ${JSON.stringify(resp.error)}`);
    return resp.result;
  }

  async #notify(method, params) {
    await this.#post({ jsonrpc: '2.0', method, params });
  }

  async initialize() {
    const result = await this.#request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'neutts-node-client', version: '0.1.0' },
    });
    await this.#notify('notifications/initialized');
    return result;
  }

  listTools() { return this.#request('tools/list'); }

  callTool(name, args) {
    return this.#request('tools/call', { name, arguments: args });
  }
}

// --- Helper spécifique NeuTTS ---
export async function synthesize(client, { text, referenceText, referenceAudioPath, ...opts }) {
  const audio = await readFile(referenceAudioPath);
  const result = await client.callTool('synthesize_speech', {
    text,
    reference_text: referenceText,
    reference_audio_base64: audio.toString('base64'),
    ...opts, // backbone, codec, device
  });
  if (result.isError) throw new Error(`Tool error: ${JSON.stringify(result.content)}`);

  const audioBlock = result.content.find(c => c.type === 'audio');
  if (!audioBlock) throw new Error(`No audio in response: ${JSON.stringify(result)}`);
  return {
    mimeType: audioBlock.mimeType,
    buffer: Buffer.from(audioBlock.data, 'base64'),
  };
}

// --- CLI demo ---
if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , refPath, refText, ...textParts] = process.argv;
  if (!refPath) {
    console.error('Usage: node neutts-client.mjs <ref.wav> <ref-transcript> <text...>');
    process.exit(1);
  }
  const client = new MCPClient('http://localhost:3000/mcp');
  await client.initialize();
  console.log('Tools:', (await client.listTools()).tools.map(t => t.name));

  const out = await synthesize(client, {
    referenceAudioPath: refPath,
    referenceText: refText,
    text: textParts.join(' '),
  });
  await writeFile('out.mp3', out.buffer);
  console.log(`Wrote out.mp3 (${out.buffer.length} bytes, ${out.mimeType})`);
}