/**
 * Auth API - Challenge, Proof, Session endpoints
 * @see ../../../specs/core/interfaces.md
 */

import { Hono } from 'hono';
import type { ErrorResponse, IdString, RiskLevel, NonNegativeInteger, CapabilitySummary, SessionTerminationReason, FreshnessStatus } from '../types.js';
import type { Proof, Verifier } from '../verifier.js';
import type { SessionManager } from '../session-manager.js';

// ============================================================================
// Request/Response Types
// ============================================================================

/** Challenge発行リクエスト */
export interface IssueChallengeRequest {
  verifier_id: IdString;
  target_agent_id: IdString;
  target_instance_id: IdString;
  intent: string;
  risk_level: RiskLevel;
  requested_capabilities?: string[];
  session_pubkey?: string;
  nonce_ttl_seconds?: number;
}

/** Challenge発行レスポンス */
export interface IssueChallengeResponse {
  challenge_id: IdString;
  target_agent_id: IdString;
  target_instance_id: IdString;
  nonce: string;
  issued_at: string;
  expires_at: string;
  verifier_session_pubkey?: string;
  intent: string;
  risk_level: RiskLevel;
  requested_capabilities?: string[];
  version_vector: {
    identity_version: NonNegativeInteger;
    revocation_epoch: NonNegativeInteger;
    policy_epoch: NonNegativeInteger;
    session_epoch: NonNegativeInteger;
    ledger_checkpoint: string;
  };
  challenge_signature: string;
}

/** Proof検証リクエスト */
export interface VerifyProofRequest {
  challenge_id: IdString;
  proof: Proof;
}

/** Proof検証レスポンス */
export interface VerifyProofResponse {
  verification_status: 'VERIFIED' | 'REJECTED' | 'DEFERRED';
  verified_agent_id?: IdString;
  verified_instance_id?: IdString;
  risk_level?: RiskLevel;
  freshness_status?: FreshnessStatus;
  capability_status?: 'MATCHED' | 'MISMATCHED' | 'DOWNGRADED';
  version_check?: {
    rollback_detected: boolean;
    epoch_mismatch: boolean;
    session_epoch_old: boolean;
    policy_mismatch: boolean;
  };
  warnings: string[];
  errors: Array<{ code: string; message: string }>;
}

/** Session作成リクエスト */
export interface CreateSessionRequest {
  verified_agent_id: IdString;
  verified_instance_id: IdString;
  peer_session_pubkey?: string;
  risk_level: RiskLevel;
  capability_summary?: CapabilitySummary;
  version_vector: {
    identity_version: NonNegativeInteger;
    revocation_epoch: NonNegativeInteger;
    policy_epoch: NonNegativeInteger;
    session_epoch: NonNegativeInteger;
    ledger_checkpoint: string;
  };
}

/** Session作成レスポンス */
export interface CreateSessionResponse {
  session_id: IdString;
  agent_id: IdString;
  instance_id: IdString;
  issued_at: string;
  expires_at: string;
  session_epoch: NonNegativeInteger;
  revocation_epoch: NonNegativeInteger;
  policy_epoch: NonNegativeInteger;
  sequence: NonNegativeInteger;
  effective_capabilities?: CapabilitySummary;
  session_status: 'ACTIVE' | 'DEGRADED' | 'REAUTH_REQUIRED' | 'TERMINATING' | 'TERMINATED';
}

/** Session終了リクエスト */
export interface TerminateSessionRequest {
  session_id: IdString;
  reason_code: SessionTerminationReason;
  reason_detail?: string;
}

/** Auth API Context Variables */
export interface AuthVariables {
  verifier: Verifier;
  sessionManager: SessionManager;
}

/** Auth API Env for Hono */
export type AuthEnv = { Variables: AuthVariables };

const app = new Hono<AuthEnv>();

/**
 * POST /v1/challenges
 * Challenge発行
 */
app.post('/challenges', async (c) => {
  const verifier = c.get('verifier');

  try {
    const request = await c.req.json<IssueChallengeRequest>();

    const challenge = await verifier.issueChallenge({
      verifier_id: request.verifier_id,
      target_agent_id: request.target_agent_id,
      target_instance_id: request.target_instance_id,
      intent: request.intent,
      risk_level: request.risk_level,
      requested_capabilities: request.requested_capabilities,
    });

    const response: IssueChallengeResponse = {
      challenge_id: challenge.challenge_id,
      target_agent_id: challenge.target_agent_id,
      target_instance_id: challenge.target_instance_id,
      nonce: challenge.nonce,
      issued_at: challenge.issued_at,
      expires_at: challenge.expires_at,
      intent: challenge.intent,
      risk_level: challenge.risk_level,
      requested_capabilities: challenge.requested_capabilities,
      version_vector: {
        identity_version: challenge.epochs.identity_version,
        revocation_epoch: challenge.epochs.revocation_epoch,
        policy_epoch: challenge.epochs.policy_epoch,
        session_epoch: challenge.epochs.session_epoch,
        ledger_checkpoint: challenge.epochs.ledger_checkpoint,
      },
      challenge_signature: challenge.signature.value,
    };

    return c.json(response, 201);
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
 * POST /v1/proofs/verify
 * Proof検証
 */
app.post('/proofs/verify', async (c) => {
  const verifier = c.get('verifier');

  try {
    const request = await c.req.json<VerifyProofRequest>();

    const result = await verifier.verifyProof(request.challenge_id, request.proof);

    const response: VerifyProofResponse = {
      verification_status: result.status,
      verified_agent_id: result.agent_id,
      verified_instance_id: result.instance_id,
      risk_level: result.risk_level,
      freshness_status: result.freshness_status,
      capability_status: result.capability_status,
      version_check: result.version_check,
      warnings: [],
      errors: result.errors || [],
    };

    if (result.status === 'VERIFIED') {
      return c.json(response, 200);
    } else if (result.status === 'REJECTED') {
      return c.json(response, 400);
    } else {
      return c.json(response, 202); // DEFERRED
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
 * POST /v1/sessions
 * Session作成
 */
app.post('/sessions', async (c) => {
  const sessionManager = c.get('sessionManager');

  try {
    const request = await c.req.json<CreateSessionRequest>();

    const session = await sessionManager.createSession({
      agent_id: request.verified_agent_id,
      instance_id: request.verified_instance_id,
      risk_level: request.risk_level,
      capabilities: request.capability_summary,
      identity_version: request.version_vector.identity_version,
      revocation_epoch: request.version_vector.revocation_epoch,
      policy_epoch: request.version_vector.policy_epoch,
      ledger_checkpoint: request.version_vector.ledger_checkpoint,
    });

    const response: CreateSessionResponse = {
      session_id: session.session_id,
      agent_id: session.agent_id,
      instance_id: session.instance_id,
      issued_at: session.issued_at,
      expires_at: session.expires_at,
      session_epoch: session.session_epoch,
      revocation_epoch: session.revocation_epoch,
      policy_epoch: session.policy_epoch,
      sequence: session.sequence,
      effective_capabilities: session.capabilities,
      session_status: 'ACTIVE',
    };

    return c.json(response, 201);
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
 * DELETE /v1/sessions/:sessionId
 * Session終了
 */
app.delete('/sessions/:sessionId', async (c) => {
  const sessionManager = c.get('sessionManager');
  const sessionId = c.req.param('sessionId') as IdString;

  try {
    // sessionIdの形式を検証
    if (!sessionId || sessionId.length < 3 || sessionId.length > 128) {
      const errorResponse: ErrorResponse = {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid session_id format',
          retryable: false,
          risk_level: 'low',
          details: { session_id: sessionId },
        },
      };
      return c.json(errorResponse, 400);
    }

    // リクエストボディから終了理由を取得
    let reason: SessionTerminationReason = 'manual_termination';

    try {
      const body = await c.req.json<TerminateSessionRequest>();
      if (body.reason_code) {
        reason = body.reason_code;
      }
    } catch (parseError) {
      // ボディのパースエラーはデバッグログを出力し、デフォルト値を使用
      console.debug('No request body or invalid JSON for session termination:', parseError);
    }

    // セッションが存在するか確認
    const session = await sessionManager.getSession(sessionId);
    if (!session) {
      const errorResponse: ErrorResponse = {
        error: {
          code: 'NOT_FOUND',
          message: `Session not found: ${sessionId}`,
          retryable: false,
          risk_level: 'low',
          details: { session_id: sessionId },
        },
      };
      return c.json(errorResponse, 404);
    }

    await sessionManager.terminateSession(sessionId, reason);

    return c.json({ session_id: sessionId, status: 'terminated' }, 200);
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

export const authApi = app;