/**
 * WebSocket + REST protocol between browser and optional Python backend.
 * Keep in sync with python/server/protocol.py and events.schema.json.
 */

import type { EventBatch, LayerId } from './events';
import type { BarContext, GenerationParams, VibeParams } from './params';

export const PROTOCOL_VERSION = 2;

export type EngineMode = 'full' | 'layers';

export interface EngineDescriptor {
  id: string;
  name: string;
  mode?: EngineMode;
  layers?: LayerId[];
}

// ---- client -> server -------------------------------------------------------

export interface ClientHello {
  type: 'hello';
  protocol: number;
  token: string;
  engineId: string;
  seed: number;
  params: GenerationParams;
}

export interface ClientInit {
  type: 'init';
  epoch: number;
  seed: number;
  engineId: string;
  params: GenerationParams;
}

export interface ClientRender {
  type: 'render';
  epoch: number;
  fromBar: number;
  count: number;
  params: GenerationParams;
  /** Required for py-neural-layers: one entry per bar in [fromBar, fromBar + count). */
  context?: BarContext[];
}

export interface ClientVibePrompt {
  type: 'vibe_prompt';
  text: string;
}

export interface ClientPing {
  type: 'ping';
  t?: number;
}

export type ClientMessage = ClientHello | ClientInit | ClientRender | ClientPing | ClientVibePrompt;

// ---- server -> client -------------------------------------------------------

export interface ServerReady {
  type: 'ready';
  engines: EngineDescriptor[];
  serverVersion: string;
}

export interface ServerBatch {
  type: 'batch';
  epoch: number;
  batch: EventBatch;
}

export interface ServerError {
  type: 'error';
  code: string;
  message: string;
}

export interface ServerPong {
  type: 'pong';
  t?: number;
  /** Rolling average ms per bar from the last GPU generation (Engine panel). */
  msPerBar?: number;
}

export interface ServerVibe {
  type: 'vibe';
  vibe: VibeParams;
  /** Optional mood suggestion from text_vibe. */
  mood?: string;
}

export type ServerMessage = ServerReady | ServerBatch | ServerError | ServerPong | ServerVibe;

/** POST /generate body */
export interface GenerateRequest {
  engineId: string;
  seed: number;
  params: GenerationParams;
  fromBar: number;
  bars: number;
}

export interface HealthResponse {
  status: 'ok';
  version: string;
  protocol: number;
  schemaVersion: number;
}

