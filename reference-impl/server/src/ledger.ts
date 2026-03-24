/**
 * Ledger - 透明性ログ / 台帳
 * @see ../../../specs/ledger/events.md
 */

import type {
  IdString,
  Timestamp,
  Signature,
  PositiveInteger,
  HashString,
  LedgerEventType,
} from './types.js';
import { verifyObject } from './crypto.js';

/** 公開鍵プロバイダー型 */
export type PublicKeyProvider = (keyId: IdString, agentId: IdString) => Promise<string | null>;

/** Ledger Event Envelope */
export interface LedgerEvent {
  spec_version: string;
  schema_version: string;
  event_id: IdString;
  event_type: LedgerEventType;
  agent_id: IdString;
  controller_id: IdString;
  event_time: Timestamp;
  recorded_at: Timestamp;
  producer_key_id: IdString;
  sequence: PositiveInteger;
  prev_event_hash?: HashString;
  payload_hash: HashString;
  ledger_checkpoint: string;
  payload: Record<string, unknown>;
  signatures: Signature[];
}

/** Ledger 設定 */
export interface LedgerConfig {
  /** ストレージルート */
  storageRoot: string;
  /** イベント保持期間 (日) */
  retentionDays: number;
  /** 公開鍵プロバイダー (オプション) */
  publicKeyProvider?: PublicKeyProvider;
}

/** Ledger インターフェース */
export interface Ledger {
  /** イベントを追加 */
  appendEvent(event: LedgerEvent): Promise<{ checkpoint: string }>;

  /** イベントを取得 */
  getEvent(eventId: IdString): Promise<LedgerEvent | null>;

  /** Agent のイベント一覧を取得 */
  getAgentEvents(
    agentId: IdString,
    options?: { sinceCheckpoint?: string; maxEvents?: number }
  ): Promise<{ events: LedgerEvent[]; checkpoint: string; hasMore: boolean }>;

  /** チェックポイントを取得 */
  getCheckpoint(): string;

  /** イベント数を取得 */
  getEventCount(): number;

  /** イベント検証 */
  validateEvent(event: LedgerEvent): Promise<{ valid: boolean; errors: string[] }>;
}

/**
 * Ledger 実装
 */
export class LedgerImpl implements Ledger {
  private config: LedgerConfig;
  private events: Map<IdString, LedgerEvent>;
  private agentEvents: Map<IdString, IdString[]>;
  private checkpoint: string;

  constructor(config: LedgerConfig) {
    this.config = config;
    this.events = new Map();
    this.agentEvents = new Map();
    this.checkpoint = `chk_0`;
  }

  async appendEvent(event: LedgerEvent): Promise<{ checkpoint: string }> {
    // イベント検証
    const validation = await this.validateEvent(event);
    if (!validation.valid) {
      throw new Error(`Invalid event: ${validation.errors.join(', ')}`);
    }

    // チェックポイント更新
    const eventCount = this.events.size + 1;
    this.checkpoint = `chk_${eventCount}`;

    // イベント保存
    this.events.set(event.event_id, { ...event, ledger_checkpoint: this.checkpoint });

    // Agent → Events マッピング
    if (!this.agentEvents.has(event.agent_id)) {
      this.agentEvents.set(event.agent_id, []);
    }
    this.agentEvents.get(event.agent_id)!.push(event.event_id);

    return { checkpoint: this.checkpoint };
  }

  async getEvent(eventId: IdString): Promise<LedgerEvent | null> {
    return this.events.get(eventId) || null;
  }

  async getAgentEvents(
    agentId: IdString,
    options?: { sinceCheckpoint?: string; maxEvents?: number }
  ): Promise<{ events: LedgerEvent[]; checkpoint: string; hasMore: boolean }> {
    const eventIds = this.agentEvents.get(agentId) || [];
    const maxEvents = options?.maxEvents || 100;

    let events = eventIds
      .map((id) => this.events.get(id)!)
      .filter((e) => e !== undefined);

    // チェックポイントでフィルタ
    if (options?.sinceCheckpoint) {
      const sinceNum = parseInt(options.sinceCheckpoint.replace('chk_', ''), 10);
      events = events.filter((e) => {
        const eventNum = parseInt(e.ledger_checkpoint.replace('chk_', ''), 10);
        return eventNum > sinceNum;
      });
    }

    // 最新順にソート
    events.sort((a, b) =>
      new Date(b.event_time).getTime() - new Date(a.event_time).getTime()
    );

    const hasMore = events.length > maxEvents;
    const limitedEvents = events.slice(0, maxEvents);

    return {
      events: limitedEvents,
      checkpoint: this.checkpoint,
      hasMore,
    };
  }

  getCheckpoint(): string {
    return this.checkpoint;
  }

  getEventCount(): number {
    return this.events.size;
  }

  async validateEvent(event: LedgerEvent): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    // 必須フィールドチェック
    if (!event.event_id) errors.push('event_id is required');
    if (!event.event_type) errors.push('event_type is required');
    if (!event.agent_id) errors.push('agent_id is required');
    if (!event.event_time) errors.push('event_time is required');
    if (!event.signatures || event.signatures.length === 0) {
      errors.push('at least one signature is required');
    }

    // イベント種別チェック
    const validTypes: LedgerEventType[] = [
      'agent.created',
      'key.added',
      'key.revoked',
      'key.rotated',
      'binding.added',
      'binding.updated',
      'binding.removed',
      'compromise.reported',
      'agent.quarantined',
      'recovery.initiated',
      'recovery.completed',
      'policy.updated',
    ];
    if (!validTypes.includes(event.event_type)) {
      errors.push(`invalid event_type: ${event.event_type}`);
    }

    // 署名検証
    if (this.config.publicKeyProvider && event.signatures && event.signatures.length > 0) {
      // 署名対象データを作成（signaturesフィールドを除く）
      const { signatures: _, ...dataToVerify } = event;

      let hasValidSignature = false;
      for (const signature of event.signatures) {
        if (!signature.value) continue;

        try {
          // 公開鍵を取得
          const publicKey = await this.config.publicKeyProvider(signature.key_id, event.agent_id);
          if (!publicKey) continue;

          // 署名検証
          const isValid = await verifyObject(dataToVerify, signature.value, publicKey);
          if (isValid) {
            hasValidSignature = true;
            break;
          }
        } catch {
          // 検証エラーは無視
          continue;
        }
      }

      if (!hasValidSignature) {
        errors.push('signature verification failed');
      }
    }

    return { valid: errors.length === 0, errors };
  }
}

// ============================================================================
// Event Payload Types
// ============================================================================

/** key.revoked ペイロード */
export interface KeyRevokedPayload {
  key_id: IdString;
  key_scope: 'root' | 'operation' | 'session' | 'recovery' | 'watcher' | 'other';
  revocation_reason: 'compromised' | 'rotated' | 'expired' | 'superseded' | 'policy_change' | 'operator_request' | 'unknown';
  effective_at: Timestamp;
  revocation_epoch: number;
  replacement_key_id?: IdString;
  linked_event_id?: IdString;
}

/** compromise.reported ペイロード */
export interface CompromiseReportedPayload {
  compromise_scope: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  detected_at: Timestamp;
  effective_at: Timestamp;
  suspected_since?: Timestamp;
  reported_reason: string;
  revocation_epoch: number;
  recommended_actions: string[];
}

/** agent.quarantined ペイロード */
export interface AgentQuarantinedPayload {
  quarantine_reason: string;
  quarantine_level: 'soft' | 'hard' | 'full';
  effective_at: Timestamp;
  revocation_epoch: number;
  policy_epoch: number;
  high_risk_blocked: boolean;
  capability_restrictions: string[];
  exchange_blocked_message_types: string[];
  exit_conditions: string[];
}

/** recovery.initiated ペイロード */
export interface RecoveryInitiatedPayload {
  recovery_id: IdString;
  initiated_at: Timestamp;
  recovery_reason: string;
  initiated_by_key_id: IdString;
  revocation_epoch: number;
  quarantine_required: boolean;
}

/** recovery.completed ペイロード */
export interface RecoveryCompletedPayload {
  recovery_id: IdString;
  completed_at: Timestamp;
  new_operation_key_ids: IdString[];
  binding_reverified: Array<{
    platform_type: string;
    platform_account_id: string;
  }>;
  revocation_epoch: number;
  identity_version: number;
  policy_epoch: number;
  quarantine_cleared: boolean;
  recovery_summary: string;
}

/** binding.updated ペイロード */
export interface BindingUpdatedPayload {
  platform_type: string;
  platform_account_id: string;
  display_handle: string;
  binding_status: 'active' | 'pending' | 'removed' | 'revoked' | 'quarantined';
  bound_by_key_id: IdString;
  binding_version: number;
  effective_at: Timestamp;
  verified_at?: Timestamp;
}