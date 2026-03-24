import { describe, it, expect, beforeEach } from 'vitest';
import { SessionManagerImpl, type SessionManagerConfig } from '../session-manager.js';

// Test vectors from positive-vectors.json
const positiveVectors = {
  POS001: {
    session: {
      session_id: 'ses_20260324_B001_001',
      agent_id: 'agt_B001',
      instance_id: 'ins_B001_001',
      issued_at: '2026-03-24T12:30:20Z',
      expires_at: '2026-03-24T12:35:20Z',
      session_epoch: 11,
      revocation_epoch: 3,
      policy_epoch: 2,
      sequence: 0,
      effective_capabilities: ['profile.read'],
      session_status: 'ACTIVE',
    },
  },
  POS003: {
    current_session: {
      session_id: 'ses_20260324_B001_001',
      agent_id: 'agt_B001',
      instance_id: 'ins_B001_001',
      issued_at: '2026-03-24T12:30:00Z',
      expires_at: '2026-03-24T12:35:00Z',
      session_epoch: 11,
      revocation_epoch: 3,
      policy_epoch: 2,
      sequence: 15,
      effective_capabilities: ['profile.read'],
      session_status: 'ACTIVE',
    },
    renew_session_request: {
      session_id: 'ses_20260324_B001_001',
      agent_id: 'agt_B001',
      instance_id: 'ins_B001_001',
      current_sequence: 15,
      reason: 'EXPIRY_APPROACHING',
    },
    expected: {
      old_session_status: 'TERMINATING',
    },
  },
};

const quarantineVectors = {
  QUAR001: {
    compromise_report: {
      agent_id: 'agt_B001',
      compromise_type: 'OPERATION_KEY_COMPROMISED',
    },
    pre_quarantine_state: {
      agent_status: 'ACTIVE',
      quarantine_status: 'NONE',
      active_sessions: ['ses_001', 'ses_002', 'ses_003'],
      effective_capabilities: ['chat.basic', 'profile.read', 'collab.invite', 'memory.exchange'],
    },
    expected: {
      agent_status: 'QUARANTINED',
      quarantine_status: 'HARD',
      sessions_terminated: ['ses_001', 'ses_002', 'ses_003'],
    },
  },
};

describe('SessionManager', () => {
  let sessionManager: SessionManagerImpl;
  const defaultConfig: SessionManagerConfig = {
    sessionTtl: 300, // 5 minutes
    maxSessions: 100,
  };

  beforeEach(() => {
    sessionManager = new SessionManagerImpl(defaultConfig);
  });

  describe('Session作成テスト', () => {
    it('should create a session with correct properties', async () => {
      const session = await sessionManager.createSession({
        agent_id: 'agt_B001',
        instance_id: 'ins_B001_001',
        risk_level: 'low',
        capabilities: ['profile.read'],
        identity_version: 5,
        revocation_epoch: 3,
        policy_epoch: 2,
        ledger_checkpoint: 'chk_100',
      });

      expect(session).toBeDefined();
      expect(session.session_id).toMatch(/^ses_/);
      expect(session.agent_id).toBe('agt_B001');
      expect(session.instance_id).toBe('ins_B001_001');
      expect(session.status).toBe('active');
      expect(session.sequence).toBe(0);
      expect(session.identity_version).toBe(5);
      expect(session.revocation_epoch).toBe(3);
      expect(session.policy_epoch).toBe(2);
      expect(session.capabilities).toEqual(['profile.read']);
    });

    it('should generate unique session IDs', async () => {
      const session1 = await sessionManager.createSession({
        agent_id: 'agt_B001',
        instance_id: 'ins_B001_001',
        risk_level: 'low',
        identity_version: 5,
        revocation_epoch: 3,
        policy_epoch: 2,
        ledger_checkpoint: 'chk_100',
      });

      const session2 = await sessionManager.createSession({
        agent_id: 'agt_B001',
        instance_id: 'ins_B001_001',
        risk_level: 'low',
        identity_version: 5,
        revocation_epoch: 3,
        policy_epoch: 2,
        ledger_checkpoint: 'chk_100',
      });

      expect(session1.session_id).not.toBe(session2.session_id);
    });

    it('should set correct expiration time based on sessionTtl config', async () => {
      const beforeCreate = Date.now();
      const session = await sessionManager.createSession({
        agent_id: 'agt_B001',
        instance_id: 'ins_B001_001',
        risk_level: 'low',
        identity_version: 5,
        revocation_epoch: 3,
        policy_epoch: 2,
        ledger_checkpoint: 'chk_100',
      });
      const afterCreate = Date.now();

      const issuedAt = new Date(session.issued_at).getTime();
      const expiresAt = new Date(session.expires_at).getTime();

      expect(expiresAt - issuedAt).toBe(defaultConfig.sessionTtl * 1000);
      expect(issuedAt).toBeGreaterThanOrEqual(beforeCreate);
      expect(issuedAt).toBeLessThanOrEqual(afterCreate);
    });

    it('should increment session_epoch on each session creation', async () => {
      const session1 = await sessionManager.createSession({
        agent_id: 'agt_B001',
        instance_id: 'ins_B001_001',
        risk_level: 'low',
        identity_version: 5,
        revocation_epoch: 3,
        policy_epoch: 2,
        ledger_checkpoint: 'chk_100',
      });

      const session2 = await sessionManager.createSession({
        agent_id: 'agt_B002',
        instance_id: 'ins_B002_001',
        risk_level: 'low',
        identity_version: 1,
        revocation_epoch: 1,
        policy_epoch: 1,
        ledger_checkpoint: 'chk_100',
      });

      expect(session2.session_epoch).toBeGreaterThan(session1.session_epoch);
    });

    it('should create session with high risk level', async () => {
      const session = await sessionManager.createSession({
        agent_id: 'agt_B001',
        instance_id: 'ins_B001_001',
        risk_level: 'high',
        capabilities: ['collab.invite', 'collab.accept'],
        identity_version: 5,
        revocation_epoch: 3,
        policy_epoch: 2,
        ledger_checkpoint: 'chk_100',
      });

      expect(session.risk_level).toBe('high');
      expect(session.capabilities).toEqual(['collab.invite', 'collab.accept']);
    });

    it('should store session and allow retrieval', async () => {
      const createdSession = await sessionManager.createSession({
        agent_id: 'agt_B001',
        instance_id: 'ins_B001_001',
        risk_level: 'low',
        identity_version: 5,
        revocation_epoch: 3,
        policy_epoch: 2,
        ledger_checkpoint: 'chk_100',
      });

      const retrievedSession = await sessionManager.getSession(createdSession.session_id);

      expect(retrievedSession).not.toBeNull();
      expect(retrievedSession?.session_id).toBe(createdSession.session_id);
      expect(retrievedSession?.agent_id).toBe(createdSession.agent_id);
    });

    it('should return null for non-existent session', async () => {
      const session = await sessionManager.getSession('nonexistent_session_id');
      expect(session).toBeNull();
    });
  });

  describe('Session更新テスト', () => {
    it('should renew a session successfully', async () => {
      const originalSession = await sessionManager.createSession({
        agent_id: 'agt_B001',
        instance_id: 'ins_B001_001',
        risk_level: 'low',
        capabilities: ['profile.read'],
        identity_version: 5,
        revocation_epoch: 3,
        policy_epoch: 2,
        ledger_checkpoint: 'chk_100',
      });

      const renewedSession = await sessionManager.renewSession(originalSession.session_id);

      expect(renewedSession.session_id).toBe(originalSession.session_id);
      expect(renewedSession.session_epoch).toBeGreaterThan(originalSession.session_epoch);
      expect(renewedSession.sequence).toBe(originalSession.sequence + 1);
      expect(renewedSession.status).toBe('active');
    });

    it('should update issued_at and expires_at on renewal', async () => {
      const originalSession = await sessionManager.createSession({
        agent_id: 'agt_B001',
        instance_id: 'ins_B001_001',
        risk_level: 'low',
        identity_version: 5,
        revocation_epoch: 3,
        policy_epoch: 2,
        ledger_checkpoint: 'chk_100',
      });

      // Wait a bit to ensure time difference
      await new Promise(resolve => setTimeout(resolve, 10));

      const renewedSession = await sessionManager.renewSession(originalSession.session_id);

      expect(new Date(renewedSession.issued_at).getTime()).toBeGreaterThan(
        new Date(originalSession.issued_at).getTime()
      );
      expect(new Date(renewedSession.expires_at).getTime()).toBeGreaterThan(
        new Date(originalSession.expires_at).getTime()
      );
    });

    it('should throw error when renewing non-existent session', async () => {
      await expect(sessionManager.renewSession('nonexistent_session')).rejects.toThrow(
        'Session not found'
      );
    });

    it('should throw error when renewing terminated session', async () => {
      const session = await sessionManager.createSession({
        agent_id: 'agt_B001',
        instance_id: 'ins_B001_001',
        risk_level: 'low',
        identity_version: 5,
        revocation_epoch: 3,
        policy_epoch: 2,
        ledger_checkpoint: 'chk_100',
      });

      await sessionManager.terminateSession(session.session_id, 'manual_termination');

      await expect(sessionManager.renewSession(session.session_id)).rejects.toThrow(
        'Cannot renew terminated session'
      );
    });

    it('should preserve other session properties on renewal', async () => {
      const originalSession = await sessionManager.createSession({
        agent_id: 'agt_B001',
        instance_id: 'ins_B001_001',
        risk_level: 'high',
        capabilities: ['collab.invite'],
        identity_version: 10,
        revocation_epoch: 5,
        policy_epoch: 3,
        ledger_checkpoint: 'chk_200',
      });

      const renewedSession = await sessionManager.renewSession(originalSession.session_id);

      expect(renewedSession.agent_id).toBe(originalSession.agent_id);
      expect(renewedSession.instance_id).toBe(originalSession.instance_id);
      expect(renewedSession.risk_level).toBe(originalSession.risk_level);
      expect(renewedSession.capabilities).toEqual(originalSession.capabilities);
      expect(renewedSession.identity_version).toBe(originalSession.identity_version);
      expect(renewedSession.revocation_epoch).toBe(originalSession.revocation_epoch);
      expect(renewedSession.policy_epoch).toBe(originalSession.policy_epoch);
      expect(renewedSession.ledger_checkpoint).toBe(originalSession.ledger_checkpoint);
    });
  });

  describe('Session終了テスト', () => {
    it('should terminate a session successfully', async () => {
      const session = await sessionManager.createSession({
        agent_id: 'agt_B001',
        instance_id: 'ins_B001_001',
        risk_level: 'low',
        identity_version: 5,
        revocation_epoch: 3,
        policy_epoch: 2,
        ledger_checkpoint: 'chk_100',
      });

      await sessionManager.terminateSession(session.session_id, 'manual_termination');

      const terminatedSession = await sessionManager.getSession(session.session_id);
      expect(terminatedSession?.status).toBe('terminated');
      expect(terminatedSession?.termination_reason).toBe('manual_termination');
    });

    it('should handle termination of non-existent session gracefully', async () => {
      // Should not throw error
      await expect(
        sessionManager.terminateSession('nonexistent_session', 'manual_termination')
      ).resolves.not.toThrow();
    });

    it('should terminate session with various reasons', async () => {
      const reasons: Array<'expired' | 'manual_termination' | 'revocation_epoch_increased' | 'quarantine'> = [
        'expired',
        'manual_termination',
        'revocation_epoch_increased',
        'quarantine',
      ];

      for (const reason of reasons) {
        const session = await sessionManager.createSession({
          agent_id: `agt_${reason}`,
          instance_id: 'ins_001',
          risk_level: 'low',
          identity_version: 1,
          revocation_epoch: 1,
          policy_epoch: 1,
          ledger_checkpoint: 'chk_1',
        });

        await sessionManager.terminateSession(session.session_id, reason);

        const terminatedSession = await sessionManager.getSession(session.session_id);
        expect(terminatedSession?.termination_reason).toBe(reason);
      }
    });

    it('should set session status to terminated after termination', async () => {
      const session = await sessionManager.createSession({
        agent_id: 'agt_B001',
        instance_id: 'ins_B001_001',
        risk_level: 'low',
        identity_version: 5,
        revocation_epoch: 3,
        policy_epoch: 2,
        ledger_checkpoint: 'chk_100',
      });

      expect(session.status).toBe('active');

      await sessionManager.terminateSession(session.session_id, 'expired');

      const terminatedSession = await sessionManager.getSession(session.session_id);
      expect(terminatedSession?.status).toBe('terminated');
    });
  });

  describe('Agent単位Session終了テスト', () => {
    it('should terminate all sessions for an agent', async () => {
      // Create multiple sessions for the same agent
      const session1 = await sessionManager.createSession({
        agent_id: 'agt_B001',
        instance_id: 'ins_B001_001',
        risk_level: 'low',
        identity_version: 5,
        revocation_epoch: 3,
        policy_epoch: 2,
        ledger_checkpoint: 'chk_100',
      });

      const session2 = await sessionManager.createSession({
        agent_id: 'agt_B001',
        instance_id: 'ins_B001_002',
        risk_level: 'low',
        identity_version: 5,
        revocation_epoch: 3,
        policy_epoch: 2,
        ledger_checkpoint: 'chk_100',
      });

      const session3 = await sessionManager.createSession({
        agent_id: 'agt_B001',
        instance_id: 'ins_B001_003',
        risk_level: 'high',
        identity_version: 5,
        revocation_epoch: 3,
        policy_epoch: 2,
        ledger_checkpoint: 'chk_100',
      });

      const terminatedCount = await sessionManager.terminateAgentSessions(
        'agt_B001',
        'revocation_epoch_increased'
      );

      expect(terminatedCount).toBe(3);

      // Verify all sessions are terminated
      const terminated1 = await sessionManager.getSession(session1.session_id);
      const terminated2 = await sessionManager.getSession(session2.session_id);
      const terminated3 = await sessionManager.getSession(session3.session_id);

      expect(terminated1?.status).toBe('terminated');
      expect(terminated2?.status).toBe('terminated');
      expect(terminated3?.status).toBe('terminated');
    });

    it('should only terminate sessions for specified agent', async () => {
      // Create sessions for multiple agents
      await sessionManager.createSession({
        agent_id: 'agt_B001',
        instance_id: 'ins_B001_001',
        risk_level: 'low',
        identity_version: 5,
        revocation_epoch: 3,
        policy_epoch: 2,
        ledger_checkpoint: 'chk_100',
      });

      const sessionA = await sessionManager.createSession({
        agent_id: 'agt_A001',
        instance_id: 'ins_A001_001',
        risk_level: 'low',
        identity_version: 1,
        revocation_epoch: 1,
        policy_epoch: 1,
        ledger_checkpoint: 'chk_100',
      });

      const terminatedCount = await sessionManager.terminateAgentSessions(
        'agt_B001',
        'quarantine'
      );

      expect(terminatedCount).toBe(1);

      // Agent A's session should still be active
      const agentASession = await sessionManager.getSession(sessionA.session_id);
      expect(agentASession?.status).toBe('active');
    });

    it('should return 0 when no sessions exist for agent', async () => {
      const terminatedCount = await sessionManager.terminateAgentSessions(
        'nonexistent_agent',
        'manual_termination'
      );

      expect(terminatedCount).toBe(0);
    });

    it('should terminate sessions for quarantine scenario (QUAR-001)', async () => {
      // Create sessions matching quarantine test vector
      const sessionIds: string[] = [];
      for (let i = 0; i < 3; i++) {
        const session = await sessionManager.createSession({
          agent_id: 'agt_B001',
          instance_id: `ins_B001_00${i + 1}`,
          risk_level: 'low',
          capabilities: ['chat.basic', 'profile.read'],
          identity_version: 5,
          revocation_epoch: 3,
          policy_epoch: 2,
          ledger_checkpoint: 'chk_100',
        });
        sessionIds.push(session.session_id);
      }

      // Terminate all sessions due to quarantine
      const terminatedCount = await sessionManager.terminateAgentSessions(
        'agt_B001',
        'quarantine'
      );

      expect(terminatedCount).toBe(3);

      // Verify all sessions are terminated with quarantine reason
      for (const sessionId of sessionIds) {
        const session = await sessionManager.getSession(sessionId);
        expect(session?.status).toBe('terminated');
        expect(session?.termination_reason).toBe('quarantine');
      }
    });
  });

  describe('期限切れSessionクリーンアップテスト', () => {
    it('should cleanup expired sessions', async () => {
      // Create a session with very short TTL
      const shortTtlManager = new SessionManagerImpl({
        sessionTtl: 0.1, // 100ms
        maxSessions: 100,
      });

      const session = await shortTtlManager.createSession({
        agent_id: 'agt_B001',
        instance_id: 'ins_B001_001',
        risk_level: 'low',
        identity_version: 5,
        revocation_epoch: 3,
        policy_epoch: 2,
        ledger_checkpoint: 'chk_100',
      });

      // Wait for session to expire
      await new Promise(resolve => setTimeout(resolve, 150));

      const cleanedCount = await shortTtlManager.cleanupExpiredSessions();

      expect(cleanedCount).toBe(1);

      const expiredSession = await shortTtlManager.getSession(session.session_id);
      expect(expiredSession?.status).toBe('terminated');
      expect(expiredSession?.termination_reason).toBe('expired');
    });

    it('should not cleanup active sessions', async () => {
      await sessionManager.createSession({
        agent_id: 'agt_B001',
        instance_id: 'ins_B001_001',
        risk_level: 'low',
        identity_version: 5,
        revocation_epoch: 3,
        policy_epoch: 2,
        ledger_checkpoint: 'chk_100',
      });

      const cleanedCount = await sessionManager.cleanupExpiredSessions();

      expect(cleanedCount).toBe(0);
    });

    it('should mark expired sessions when retrieved', async () => {
      const shortTtlManager = new SessionManagerImpl({
        sessionTtl: 0.1, // 100ms
        maxSessions: 100,
      });

      const session = await shortTtlManager.createSession({
        agent_id: 'agt_B001',
        instance_id: 'ins_B001_001',
        risk_level: 'low',
        identity_version: 5,
        revocation_epoch: 3,
        policy_epoch: 2,
        ledger_checkpoint: 'chk_100',
      });

      // Wait for session to expire
      await new Promise(resolve => setTimeout(resolve, 150));

      const expiredSession = await shortTtlManager.getSession(session.session_id);

      expect(expiredSession?.status).toBe('expired');
    });
  });

  describe('Session検証テスト', () => {
    it('should maintain session epoch monotonicity', async () => {
      const epochs: number[] = [];

      for (let i = 0; i < 5; i++) {
        const session = await sessionManager.createSession({
          agent_id: `agt_${i}`,
          instance_id: `ins_${i}`,
          risk_level: 'low',
          identity_version: 1,
          revocation_epoch: 1,
          policy_epoch: 1,
          ledger_checkpoint: 'chk_1',
        });
        epochs.push(session.session_epoch);
      }

      // Verify monotonicity
      for (let i = 1; i < epochs.length; i++) {
        expect(epochs[i]).toBeGreaterThan(epochs[i - 1]);
      }
    });

    it('should increment session epoch on renewal', async () => {
      const session = await sessionManager.createSession({
        agent_id: 'agt_B001',
        instance_id: 'ins_B001_001',
        risk_level: 'low',
        identity_version: 5,
        revocation_epoch: 3,
        policy_epoch: 2,
        ledger_checkpoint: 'chk_100',
      });

      const originalEpoch = session.session_epoch;

      const renewedSession = await sessionManager.renewSession(session.session_id);

      expect(renewedSession.session_epoch).toBeGreaterThan(originalEpoch);
    });
  });
});