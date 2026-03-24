/**
 * Revocation API - Revocation Status endpoint
 * @see ../../../specs/core/interfaces.md
 */

import { Hono } from 'hono';
import type { ErrorResponse, IdString, RiskLevel, NonNegativeInteger, FreshnessStatus, AgentStatus, QuarantineLevel } from '../types.js';
import type { IdentityHost, IdentityManifest } from '../identity-host.js';

// ============================================================================
// Request/Response Types
// ============================================================================

/** Freshness確認リクエスト */
export interface CheckFreshnessRequest {
  agent_id: IdString;
  required_risk_level: RiskLevel;
  known_revocation_epoch?: NonNegativeInteger;
  known_identity_version?: NonNegativeInteger;
  known_ledger_checkpoint?: string;
}

/** Freshness確認レスポンス */
export interface CheckFreshnessResponse {
  freshness_status: FreshnessStatus;
  agent_status: AgentStatus;
  quarantine_status: 'NONE' | 'SOFT' | 'HARD';
  current_revocation_epoch: NonNegativeInteger;
  current_identity_version: NonNegativeInteger;
  current_policy_epoch: NonNegativeInteger;
  ledger_checkpoint: string;
  fresh_until: string;
  warnings: string[];
}

/** Revocation Status */
export interface RevocationStatus {
  agent_id: IdString;
  agent_status: AgentStatus;
  quarantine_status: QuarantineLevel;
  revocation_epoch: NonNegativeInteger;
  identity_version: NonNegativeInteger;
  policy_epoch: NonNegativeInteger;
  last_updated_at: string;
}

// ============================================================================
// Revocation API
// ============================================================================

/** Revocation API Context Variables */
export interface RevocationVariables {
  identityHost: IdentityHost;
}

/** Revocation API Env for Hono */
export type RevocationEnv = { Variables: RevocationVariables };

const app = new Hono<RevocationEnv>();

/**
 * GET /v1/agents/:agentId/revocation
 * Revocation Status取得
 */
app.get('/:agentId/revocation', async (c) => {
  const agentId = c.req.param('agentId') as IdString;
  const identityHost = c.get('identityHost');

  // クエリパラメータを取得
  const requiredRiskLevel = (c.req.query('required_risk_level') as RiskLevel) || 'low';
  const knownRevocationEpoch = c.req.query('known_revocation_epoch')
    ? parseInt(c.req.query('known_revocation_epoch')!, 10)
    : undefined;
  const knownIdentityVersion = c.req.query('known_identity_version')
    ? parseInt(c.req.query('known_identity_version')!, 10)
    : undefined;
  const knownLedgerCheckpoint = c.req.query('known_ledger_checkpoint');

  try {
    const manifest = await identityHost.getManifest(agentId);

    if (!manifest) {
      const errorResponse: ErrorResponse = {
        error: {
          code: 'NOT_FOUND',
          message: `Agent not found: ${agentId}`,
          retryable: false,
          risk_level: requiredRiskLevel,
          details: { agent_id: agentId },
        },
      };
      return c.json(errorResponse, 404);
    }

    // Revocation Statusを構築
    const revocationStatus: RevocationStatus = {
      agent_id: agentId,
      agent_status: manifest.status ?? 'active',
      quarantine_status: manifest.quarantine_status ?? 'none',
      revocation_epoch: manifest.identity_version, // 簡易実装
      identity_version: manifest.identity_version,
      policy_epoch: manifest.policy_epoch ?? 0,
      last_updated_at: manifest.updated_at,
    };

    // Freshness確認
    const freshnessStatus = determineFreshness(
      manifest,
      knownRevocationEpoch,
      knownIdentityVersion,
      knownLedgerCheckpoint
    );

    // High-riskの場合、freshnessが古いか矛盾しているとエラー
    if (requiredRiskLevel === 'high' && (freshnessStatus === 'stale' || freshnessStatus === 'inconsistent')) {
      const errorResponse: ErrorResponse = {
        error: {
          code: 'STALE_REVOCATION_CACHE',
          message: 'Revocation status is stale for high-risk operation',
          retryable: true,
          risk_level: 'high',
          details: {
            freshness_status: freshnessStatus,
            agent_id: agentId,
          },
        },
      };
      return c.json(errorResponse, 400);
    }

    const response: CheckFreshnessResponse = {
      freshness_status: freshnessStatus,
      agent_status: revocationStatus.agent_status,
      quarantine_status: revocationStatus.quarantine_status === 'none'
        ? 'NONE'
        : revocationStatus.quarantine_status === 'soft'
          ? 'SOFT'
          : 'HARD',
      current_revocation_epoch: revocationStatus.revocation_epoch,
      current_identity_version: revocationStatus.identity_version,
      current_policy_epoch: revocationStatus.policy_epoch,
      ledger_checkpoint: manifest.ledger_checkpoint ?? `chk_${manifest.identity_version}_${Date.now()}`,
      fresh_until: new Date(Date.now() + 120 * 1000).toISOString(), // 2分後
      warnings: [],
    };

    return c.json(response, 200);
  } catch (error) {
    const errorResponse: ErrorResponse = {
      error: {
        code: 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
        retryable: true,
        risk_level: requiredRiskLevel,
        details: {},
      },
    };
    return c.json(errorResponse, 500);
  }
});

/**
 * Freshness状態を判定
 */
function determineFreshness(
  manifest: IdentityManifest,
  knownRevocationEpoch?: NonNegativeInteger,
  knownIdentityVersion?: NonNegativeInteger,
  knownLedgerCheckpoint?: string
): FreshnessStatus {
  // 既知の情報がない場合は不明
  if (knownRevocationEpoch === undefined && knownIdentityVersion === undefined) {
    return 'unknown';
  }

  // Identity version のロールバック検知
  if (knownIdentityVersion !== undefined && manifest.identity_version < knownIdentityVersion) {
    return 'inconsistent';
  }

  // Revocation epoch の減少検知
  if (knownRevocationEpoch !== undefined && manifest.identity_version < knownRevocationEpoch) {
    return 'inconsistent';
  }

  // バージョンが同じ場合は fresh
  if (
    knownIdentityVersion === manifest.identity_version &&
    (knownRevocationEpoch === undefined || knownRevocationEpoch === manifest.identity_version)
  ) {
    return 'fresh';
  }

  // 新しいバージョンがある場合は fresh
  return 'fresh';
}

export const revocationApi = app;