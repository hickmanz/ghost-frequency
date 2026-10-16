/**
 * WebSocket + REST protocol between browser and optional Python backend.
 * Keep in sync with python/server/protocol.py and events.schema.json.
 */

import type { EventBatch } from './events';
import type { GenerationParams } from './params';

export const PROTOCOL_VERSION = 1;

export interface EngineDescriptor {
  id: string;
  name: string;
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
}

export interface ClientPing {
  type: 'ping';
  t?: number;
}

export type ClientMessage = ClientHello | ClientInit | ClientRender | ClientPing;

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
}

export type ServerMessage = ServerReady | ServerBatch | ServerError | ServerPong;

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

