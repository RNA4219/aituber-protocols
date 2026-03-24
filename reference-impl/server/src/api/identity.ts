/**
 * Identity API - Identity Manifest endpoints
 * @see ../../../specs/core/interfaces.md
 */

import { Hono } from 'hono';
import type { ErrorResponse, IdString, RiskLevel } from '../types.js';
import type { IdentityManifest, IdentityHost } from '../identity-host.js';

/** Identity API Context Variables */
export interface IdentityVariables {
  identityHost: IdentityHost;
}

/** Identity API Env for Hono */
export type IdentityEnv = { Variables: IdentityVariables };

const app = new Hono<IdentityEnv>();

/**
 * GET /v1/agents/:agentId/manifest
 * Identity Manifest取得
 */
app.get('/:agentId/manifest', async (c) => {
  const agentId = c.req.param('agentId') as IdString;
  const identityHost = c.get('identityHost');

  try {
    const manifest = await identityHost.getManifest(agentId);

    if (!manifest) {
      const errorResponse: ErrorResponse = {
        error: {
          code: 'NOT_FOUND',
          message: `Identity manifest not found for agent: ${agentId}`,
          retryable: false,
          risk_level: 'low',
          details: { agent_id: agentId },
        },
      };
      return c.json(errorResponse, 404);
    }

    return c.json(manifest);
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
 * PUT /v1/agents/:agentId/manifest
 * Identity Manifest更新
 */
app.put('/:agentId/manifest', async (c) => {
  const agentId = c.req.param('agentId') as IdString;
  const identityHost = c.get('identityHost');

  try {
    const manifest = await c.req.json<IdentityManifest>();

    // agent_id の一致確認
    if (manifest.agent_id !== agentId) {
      const errorResponse: ErrorResponse = {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'agent_id in manifest does not match URL path',
          retryable: false,
          risk_level: 'low',
          details: {
            path_agent_id: agentId,
            manifest_agent_id: manifest.agent_id,
          },
        },
      };
      return c.json(errorResponse, 400);
    }

    // Manifest保存
    await identityHost.saveManifest(manifest);

    return c.json(manifest, 200);
  } catch (error) {
    if (error instanceof Error && error.message === 'Invalid manifest signature') {
      const errorResponse: ErrorResponse = {
        error: {
          code: 'INVALID_SIGNATURE',
          message: 'Manifest signature verification failed',
          retryable: false,
          risk_level: 'high',
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

export const identityApi = app;