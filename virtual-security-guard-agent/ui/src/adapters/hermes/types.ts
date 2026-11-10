// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

export interface HermesSession {
  id: string;
  title: string;
  startedAt?: number;
  lastActive?: number;
  preview?: string;
  messageCount?: number;
}

/** One page of `GET /api/sessions` (most recently active first). */
export interface HermesSessionPage {
  sessions: HermesSession[];
  hasMore: boolean;
}

/** `GET /v1/runs/{id}`: queued, running, stopping, completed, failed, ... */
export interface HermesRunStatus {
  status: string;
  output?: string;
  error?: string;
}

export interface HermesToolCall {
  id?: string;
  name: string;
  arguments?: string;
}

export interface HermesMessage {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  toolCalls?: HermesToolCall[];
  toolName?: string;
  toolCallId?: string;
  timestamp?: number;
}

export interface StartRunRequest {
  input: string;
  sessionId?: string;
  instructions?: string;
}

/** Normalised run events (Hermes `/v1/runs/{id}/events` SSE). */
export type RunEvent =
  | { type: "delta"; seq?: number; text: string }
  | { type: "reasoning"; seq?: number; text: string }
  | { type: "tool.started"; seq?: number; tool: string; preview?: string }
  | {
      type: "tool.completed";
      seq?: number;
      tool: string;
      preview?: string;
      error?: boolean;
    }
  | { type: "completed"; seq?: number; output?: string; interrupted?: boolean }
  | { type: "failed"; seq?: number; error: string }
  | { type: "cancelled"; seq?: number }
  | { type: "other"; seq?: number; event: string; data: unknown };

export interface HermesAdapter {
  health(): Promise<boolean>;
  createSession(title: string): Promise<HermesSession>;
  listSessions(page?: {
    limit?: number;
    offset?: number;
  }): Promise<HermesSessionPage>;
  getSession(sessionId: string): Promise<HermesSession>;
  getMessages(sessionId: string): Promise<HermesMessage[]>;
  deleteSession(sessionId: string): Promise<void>;
  startRun(req: StartRunRequest): Promise<{ runId: string }>;
  /** Resolves when the stream closes (terminal event or connection end). */
  streamRun(
    runId: string,
    onEvent: (e: RunEvent) => void,
    signal?: AbortSignal,
  ): Promise<void>;
  getRun(runId: string): Promise<HermesRunStatus>;
  stopRun(runId: string): Promise<void>;
}

export class HermesError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "HermesError";
    this.status = status;
  }
}
