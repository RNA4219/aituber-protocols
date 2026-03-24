/**
 * Ledger API - Ledger Event endpoints
 * @see ../../../specs/core/interfaces.md
 */

import { Hono } from 'hono';
import type { ErrorResponse, IdString } from '../types.js';
import type { Ledger, LedgerEvent } from '../ledger.js';

// ============================================================================
// Request/Response Types
// ============================================================================

/** イベント追加リクエスト */
export interface AppendEventRequest {
  event: LedgerEvent;
}

/** イベント追加レスポンス */
export interface AppendEventResponse {
  append_status: 'APPENDED' | 'REJECTED' | 'DUPLICATED' | 'CONFLICTED';
  event_id: IdString;
  checkpoint: string;
}

/** イベント一覧取得レスポンス */
export interface ListEventsResponse {
  agent_id: IdString;
  current_checkpoint: string;
  events: LedgerEvent[];
  has_more: boolean;
}

/** チェックポイント取得レスポンス */
export interface CheckpointResponse {
  checkpoint: string;
  event_count: number;
  last_updated_at: string;
}

// ============================================================================
// Ledger API
// ============================================================================

/** Ledger API Context Variables */
export interface LedgerVariables {
  ledger: Ledger;
}

/** Ledger API Env for Hono */
export type LedgerEnv = { Variables: LedgerVariables };

const app = new Hono<LedgerEnv>();

/**
 * POST /v1/ledger/events
 * イベント追加
 */
app.post('/events', async (c) => {
  const ledger = c.get('ledger');

  try {
    const request = await c.req.json<AppendEventRequest>();

    if (!request.event) {
      const errorResponse: ErrorResponse = {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'event is required',
          retryable: false,
          risk_level: 'low',
          details: {},
        },
      };
      return c.json(errorResponse, 400);
    }

    // イベント検証
    const validation = await ledger.validateEvent(request.event);
    if (!validation.valid) {
      const errorResponse: ErrorResponse = {
        error: {
          code: 'VALIDATION_ERROR',
          message: `Invalid event: ${validation.errors.join(', ')}`,
          retryable: false,
          risk_level: 'low',
          details: { errors: validation.errors },
        },
      };
      return c.json(errorResponse, 400);
    }

    // イベント追加
    const result = await ledger.appendEvent(request.event);

    const response: AppendEventResponse = {
      append_status: 'APPENDED',
      event_id: request.event.event_id,
      checkpoint: result.checkpoint,
    };

    return c.json(response, 201);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Invalid event:')) {
      const errorResponse: ErrorResponse = {
        error: {
          code: 'VALIDATION_ERROR',
          message: error.message,
          retryable: false,
          risk_level: 'low',
          details: {},
        },
      };
      return c.json(errorResponse, 400);
    }

    const errorResponse: ErrorResponse = {
      error: {
        code: 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
        retryable: true,
        risk_level: 'low',
        details: {},
      },
    };
    return c.json(errorResponse, 500);
  }
});

/**
 * GET /v1/ledger/events
 * イベント一覧取得
 */
app.get('/events', async (c) => {
  const ledger = c.get('ledger');

  // クエリパラメータを取得
  const agentId = c.req.query('agent_id') as IdString | undefined;
  const sinceCheckpoint = c.req.query('since_checkpoint');
  const maxEvents = c.req.query('max_events')
    ? parseInt(c.req.query('max_events')!, 10)
    : 100;

  try {
    if (agentId) {
      // 特定Agentのイベント一覧
      const result = await ledger.getAgentEvents(agentId, {
        sinceCheckpoint,
        maxEvents,
      });

      const response: ListEventsResponse = {
        agent_id: agentId,
        current_checkpoint: result.checkpoint,
        events: result.events,
        has_more: result.hasMore,
      };

      return c.json(response, 200);
    } else {
      // 全イベント一覧は実装していないので、チェックポイントのみ返す
      const checkpoint = ledger.getCheckpoint();

      const response: CheckpointResponse = {
        checkpoint,
        event_count: ledger.getEventCount(),
        last_updated_at: new Date().toISOString(),
      };

      return c.json(response, 200);
    }
  } catch (error) {
    const errorResponse: ErrorResponse = {
      error: {
        code: 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
        retryable: true,
        risk_level: 'low',
        details: {},
      },
    };
    return c.json(errorResponse, 500);
  }
});

/**
 * GET /v1/ledger/checkpoint
 * チェックポイント取得
 */
app.get('/checkpoint', async (c) => {
  const ledger = c.get('ledger');

  try {
    const checkpoint = ledger.getCheckpoint();

    const response: CheckpointResponse = {
      checkpoint,
      event_count: ledger.getEventCount(),
      last_updated_at: new Date().toISOString(),
    };

    return c.json(response, 200);
  } catch (error) {
    const errorResponse: ErrorResponse = {
      error: {
        code: 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
        retryable: true,
        risk_level: 'low',
        details: {},
      },
    };
    return c.json(errorResponse, 500);
  }
});

/**
 * GET /v1/ledger/events/:eventId
 * 特定イベント取得
 */
app.get('/events/:eventId', async (c) => {
  const ledger = c.get('ledger');
  const eventId = c.req.param('eventId') as IdString;

  try {
    const event = await ledger.getEvent(eventId);

    if (!event) {
      const errorResponse: ErrorResponse = {
        error: {
          code: 'NOT_FOUND',
          message: `Event not found: ${eventId}`,
          retryable: false,
          risk_level: 'low',
          details: { event_id: eventId },
        },
      };
      return c.json(errorResponse, 404);
    }

    return c.json(event, 200);
  } catch (error) {
    const errorResponse: ErrorResponse = {
      error: {
        code: 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
        retryable: true,
        risk_level: 'low',
        details: {},
      },
    };
    return c.json(errorResponse, 500);
  }
});

export const ledgerApi = app;