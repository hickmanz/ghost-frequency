import {
  PROTOCOL_VERSION,
  type ClientHello,
  type ClientMessage,
  type EngineDescriptor,
  type GenerateRequest,
  type HealthResponse,
  type ServerMessage,
} from '@shared/index';

export type BackendConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export type WebSocketFactory = (url: string) => WebSocket;

export interface BackendClientOptions {
  wsFactory?: WebSocketFactory;
  onStatus?: (status: BackendConnectionStatus) => void;
  onMessage?: (msg: ServerMessage) => void;
  onError?: (code: string, message: string) => void;
}

const DEFAULT_WS = (url: string) => new WebSocket(url);

function wsUrl(httpUrl: string): string {
  const u = new URL(httpUrl);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.pathname = u.pathname.replace(/\/$/, '') + '/ws';
  return u.toString();
}

/** Errors that should not trigger an automatic reconnect loop. */
function isTerminalError(code: string): boolean {
  return (
    code === 'auth_failed' ||
    code === 'protocol_mismatch' ||
    code === 'Origin not allowed' ||
    code === 'invalid_message' ||
    code === 'hello_timeout' ||
    code === 'internal'
  );
}

export class BackendClient {
  private ws: WebSocket | null = null;
  private status: BackendConnectionStatus = 'disconnected';
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimeout: ReturnType<typeof setTimeout> | null = null;
  private backoffMs = 1000;
  private manualDisconnect = false;
  private url = '';
  private token = '';
  private engines: EngineDescriptor[] = [];
  private lastLatencyMs = 0;
  private listeners = new Set<(msg: ServerMessage) => void>();
  private haltReconnect = false;

  constructor(private readonly opts: BackendClientOptions = {}) {}

  subscribe(fn: (msg: ServerMessage) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(msg: ServerMessage): void {
    this.opts.onMessage?.(msg);
    this.listeners.forEach((fn) => fn(msg));
  }

  get connectionStatus(): BackendConnectionStatus {
    return this.status;
  }

  get availableEngines(): EngineDescriptor[] {
    return this.engines;
  }

  get latencyMs(): number {
    return this.lastLatencyMs;
  }

  private setStatus(s: BackendConnectionStatus): void {
    this.status = s;
    this.opts.onStatus?.(s);
  }

  async health(baseUrl: string): Promise<HealthResponse> {
    const u = new URL('/health', baseUrl.replace(/\/$/, '') + '/');
    const res = await fetch(u.toString());
    if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
    return (await res.json()) as HealthResponse;
  }

  async generate(baseUrl: string, token: string, body: GenerateRequest): Promise<unknown> {
    const u = new URL('/generate', baseUrl.replace(/\/$/, '') + '/');
    const res = await fetch(u.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Generate failed: ${res.status}`);
    return res.json();
  }

  private helloPayload: (() => ClientHello) | null = null;

  connect(baseUrl: string, token: string, hello: Omit<Extract<ClientMessage, { type: 'hello' }>, 'type' | 'protocol' | 'token'>): void {
    this.manualDisconnect = false;
    this.haltReconnect = false;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.url = baseUrl.replace(/\/$/, '');
    this.token = token;
    this.helloPayload = () => ({
      type: 'hello',
      protocol: PROTOCOL_VERSION,
      token: this.token,
      ...hello,
    });
    this.openSocket(this.helloPayload());
  }

  disconnect(): void {
    this.manualDisconnect = true;
    this.clearTimers();
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setStatus('disconnected');
  }

  send(msg: ClientMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(msg));
  }

  private openSocket(firstMessage: ClientMessage): void {
    this.clearTimers();
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setStatus('connecting');
    const factory = this.opts.wsFactory ?? DEFAULT_WS;
    const socket = factory(wsUrl(this.url));
    this.ws = socket;

    socket.onopen = () => {
      socket.send(JSON.stringify(firstMessage));
    };

    socket.onmessage = (ev) => {
      let data: ServerMessage;
      try {
        data = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return;
      }
      if (data.type === 'ready') {
        this.engines = data.engines;
        this.setStatus('connected');
        this.backoffMs = 1000;
        this.startHeartbeat();
      } else if (data.type === 'error') {
        this.opts.onError?.(data.code, data.message);
        if (isTerminalError(data.code)) {
          this.haltReconnect = true;
          this.setStatus('error');
          if (data.code === 'auth_failed' || data.code === 'protocol_mismatch') {
            this.manualDisconnect = true;
          }
          socket.close();
        }
      } else if (data.type === 'pong' && data.t !== undefined) {
        this.lastLatencyMs = Math.max(0, Date.now() - data.t);
        if (this.pongTimeout !== null) clearTimeout(this.pongTimeout);
        this.pongTimeout = null;
      }
      this.emit(data);
    };

    socket.onclose = () => {
      this.clearTimers();
      this.ws = null;
      if (this.manualDisconnect) {
        this.setStatus('disconnected');
        return;
      }
      if (this.haltReconnect) {
        this.setStatus('error');
        return;
      }
      this.setStatus('error');
      this.scheduleReconnect();
    };

    socket.onerror = () => {
      // onclose handles reconnect
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    const delay = this.backoffMs + Math.random() * 400;
    this.backoffMs = Math.min(this.backoffMs * 2, 30_000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.manualDisconnect && this.helloPayload) this.openSocket(this.helloPayload());
    }, delay);
  }

  private startHeartbeat(): void {
    if (this.pingTimer !== null) clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const t = Date.now();
      this.send({ type: 'ping', t });
      if (this.pongTimeout !== null) clearTimeout(this.pongTimeout);
      this.pongTimeout = setTimeout(() => {
        this.ws?.close();
      }, 8000);
    }, 15_000);
  }

  private clearTimers(): void {
    if (this.pingTimer !== null) clearInterval(this.pingTimer);
    if (this.pongTimeout !== null) clearTimeout(this.pongTimeout);
    this.pingTimer = null;
    this.pongTimeout = null;
  }
}
