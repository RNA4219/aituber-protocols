# AITuber Authentication Protocol Test Vectors

This directory contains test vectors for validating the AITuber mutual authentication protocol implementation.

## Directory Structure

```
test-vectors/
  auth/
    positive-vectors.json   # Successful authentication scenarios
    negative-vectors.json   # Failure and rejection scenarios
  replay/
    replay-vectors.json     # Replay attack detection tests
  rollback/
    rollback-vectors.json   # Rollback detection tests
  quarantine/
    quarantine-vectors.json # Quarantine state tests
  README.md                 # This file
```

## Test Vector Format

Each test vector follows a consistent structure:

```json
{
  "id": "UNIQUE_ID",
  "name": "descriptive_name",
  "description": "Human-readable description of the test",
  "scenario": "Detailed scenario being tested",
  "input": {
    // Input data for the test
  },
  "expected_output": {
    // Expected result
  }
}
```

## Test Categories

### Positive Vectors (`auth/positive-vectors.json`)

Tests for successful authentication and operation scenarios:

| ID | Name | Description |
|----|------|-------------|
| POS-001 | basic_low_risk_authentication | Basic successful authentication for low-risk operation |
| POS-002 | high_risk_authentication_with_fresh_revocation_proof | High-risk operation with fresh revocation proof |
| POS-003 | session_renewal | Session renewal before expiry |
| POS-004 | platform_binding_verification | Cross-platform binding verification |
| POS-005 | soft_stale_identity_cache_low_risk | Low-risk operation with soft stale identity cache |
| POS-006 | capability_downgrade_low_risk | Capability downgrade for stale cache |
| POS-007 | cross_platform_identity_resolution | Same agent from different platforms |
| POS-008 | exchange_message_hello | Hello message exchange |
| POS-009 | collab_invite_accept_flow | Collaboration invite and accept |
| POS-010 | first_seen_bootstrap_with_watcher_evidence | First-seen peer with watcher evidence |

### Negative Vectors (`auth/negative-vectors.json`)

Tests for authentication failures and rejection scenarios:

| ID | Name | Error Code | Description |
|----|------|------------|-------------|
| NEG-001 | invalid_signature | INVALID_SIGNATURE | Proof signature verification failed |
| NEG-002 | nonce_expired | NONCE_EXPIRED | Challenge nonce has expired |
| NEG-003 | timestamp_invalid_clock_skew | TIMESTAMP_INVALID | Clock skew exceeds threshold |
| NEG-004 | key_revoked | KEY_REVOKED | Operation key has been revoked |
| NEG-005 | binding_mismatch | BINDING_MISMATCH | Platform binding does not match |
| NEG-006 | policy_mismatch | POLICY_MISMATCH | Policy epoch mismatch |
| NEG-007 | stale_revocation_cache_high_risk | STALE_REVOCATION_CACHE | Fresh proof required for high-risk |
| NEG-008 | session_epoch_old | SESSION_EPOCH_OLD | Session epoch is outdated |
| NEG-009 | identity_rollback_detected | IDENTITY_ROLLBACK_DETECTED | Identity version regression |
| NEG-010 | agent_quarantined_high_risk | AGENT_QUARANTINED | Agent in quarantine |
| NEG-011 | invalid_manifest_signature | INVALID_MANIFEST_SIGNATURE | Manifest signature failed |
| NEG-012 | capability_digest_mismatch | CAPABILITY_DIGEST_MISMATCH | Capability digest mismatch |
| NEG-013 | high_risk_without_fresh_proof | HIGH_RISK_REQUIRES_FRESH_PROOF | Fresh proof required |
| NEG-014 | conflicting_revocation_state | CONFLICTING_REVOCATION_STATE | Conflicting status sources |
| NEG-015 | ledger_checkpoint_old | LEDGER_CHECKPOINT_OLD | Checkpoint regression |
| NEG-016 | revocation_epoch_regression | REVOCATION_EPOCH_REGRESSION | Epoch regression |
| NEG-017 | session_terminated | SESSION_TERMINATED | Session has been terminated |
| NEG-018 | untrusted_redirect | UNTRUSTED_REDIRECT | Manifest redirects to untrusted location |
| NEG-019 | first_seen_high_risk_immediate_reject | FIRST_SEEN_HIGH_RISK_DENIED | First-seen high-risk rejected |
| NEG-020 | recovery_sequence_invalid | RECOVERY_SEQUENCE_INVALID | Recovery sequence incomplete |

### Replay Vectors (`replay/replay-vectors.json`)

Tests for replay attack detection:

| ID | Name | Description |
|----|------|-------------|
| REPLAY-001 | nonce_reuse_same_challenge | Nonce reuse within same challenge |
| REPLAY-002 | nonce_reuse_different_challenge | Nonce reuse across challenges |
| REPLAY-003 | sequence_replay_detection | Exchange message sequence replay |
| REPLAY-004 | old_timestamp_replay | Message with old timestamp |
| REPLAY-005 | session_id_reuse_after_termination | Terminated session reuse |
| REPLAY-006 | proof_replay_after_session_expiry | Expired session proof reuse |
| REPLAY-007 | collab_invite_replay | Collaboration invite replay |
| REPLAY-008 | mac_replay_detection | MAC reuse detection |
| REPLAY-009 | challenge_replay_different_agent | Proof intended for different agent |
| REPLAY-010 | cross_session_nonce_replay | Nonce replay across sessions |
| REPLAY-011 | time_window_replay | Replay within time window but outside challenge |
| REPLAY-012 | verifier_restart_nonce_check | Nonce detection after restart |

### Rollback Vectors (`rollback/rollback-vectors.json`)

Tests for rollback and epoch regression detection:

| ID | Name | Description |
|----|------|-------------|
| ROLLBACK-001 | identity_version_rollback | Identity version regression |
| ROLLBACK-002 | revocation_epoch_regression | Revocation epoch regression |
| ROLLBACK-003 | policy_epoch_regression | Policy epoch regression |
| ROLLBACK-004 | ledger_checkpoint_regression | Ledger checkpoint regression |
| ROLLBACK-005 | multi_field_rollback | Multiple field regressions |
| ROLLBACK-006 | binding_version_rollback | Platform binding version rollback |
| ROLLBACK-007 | session_epoch_rollback | Session epoch rollback |
| ROLLBACK-008 | key_rotation_rollback | Key rotation rollback attempt |
| ROLLBACK-009 | split_view_detection | Split-view attack detection |
| ROLLBACK-010 | freeze_attack_detection | Freeze attack detection |
| ROLLBACK-011 | recovery_state_rollback | Recovery state rollback |
| ROLLBACK-012 | first_seen_bootstrap_no_rollback | First-seen without rollback detection |

### Quarantine Vectors (`quarantine/quarantine-vectors.json`)

Tests for quarantine state management:

| ID | Name | Description |
|----|------|-------------|
| QUAR-001 | quarantine_initiation_key_compromise | Quarantine after key compromise |
| QUAR-002 | quarantine_high_risk_operation_denied | High-risk operation denied |
| QUAR-003 | quarantine_low_risk_capability_downgrade | Low-risk with capability downgrade |
| QUAR-004 | quarantine_memory_exchange_blocked | Memory exchange blocked |
| QUAR-005 | quarantine_invite_accept_blocked | Invite acceptance blocked |
| QUAR-006 | quarantine_binding_update_blocked | Binding update blocked |
| QUAR-007 | recovery_completion | Recovery completion removes quarantine |
| QUAR-008 | soft_quarantine_to_hard_escalation | Quarantine escalation |
| QUAR-009 | quarantine_recovery_sequence_incomplete | Incomplete recovery sequence |
| QUAR-010 | quarantine_new_session_denied | New session denied |
| QUAR-011 | quarantine_multiple_compromise_types | Multiple compromise types |
| QUAR-012 | quarantine_partial_recovery | Partial recovery |

## Key Concepts

### Risk Levels

- **LOW**: Basic operations like profile viewing, status queries
- **HIGH**: Sensitive operations like memory exchange, collaboration invites, binding updates

### Freshness States

- **FRESH**: Cache is within valid TTL
- **SOFT_STALE**: Past soft TTL but within hard TTL
- **HARD_STALE**: Past hard TTL - unusable for high-risk

### Quarantine States

- **NONE**: Agent is not quarantined
- **SOFT**: Limited operations allowed with capability downgrade
- **HARD**: All high-risk operations blocked, existing sessions terminated

### Monotonic Fields

The following fields must only increase:

- `identity_version`: Version of identity manifest
- `revocation_epoch`: Counter for revocation events
- `policy_epoch`: Version of policy
- `ledger_checkpoint`: Ledger consistency checkpoint

## Error Codes Reference

| Code | Risk Level | Retryable | Description |
|------|------------|-----------|-------------|
| INVALID_SIGNATURE | HIGH | No | Proof signature verification failed |
| NONCE_EXPIRED | LOW | Yes | Challenge nonce has expired |
| NONCE_REPLAY | HIGH | No | Nonce has been used before |
| TIMESTAMP_INVALID | HIGH | No | Timestamp outside acceptable window |
| KEY_REVOKED | HIGH | No | Operation key has been revoked |
| BINDING_MISMATCH | HIGH | No | Platform binding does not match |
| POLICY_MISMATCH | HIGH | Yes | Policy epoch mismatch |
| STALE_REVOCATION_CACHE | HIGH | Yes | Fresh revocation proof required |
| SESSION_EPOCH_OLD | HIGH | Yes | Session epoch is outdated |
| IDENTITY_ROLLBACK_DETECTED | HIGH | No | Identity version regression detected |
| AGENT_QUARANTINED | HIGH | No | Agent is in quarantine |
| LEDGER_CHECKPOINT_OLD | HIGH | No | Ledger checkpoint regression |
| REVOCATION_EPOCH_REGRESSION | HIGH | No | Revocation epoch regression |
| SESSION_TERMINATED | HIGH | No | Session has been terminated |

## Implementation Notes

### Cache TTL Recommendations (MVP)

| Cache Type | Soft TTL | Hard TTL |
|------------|----------|----------|
| Identity Cache | 300 seconds | 3600 seconds |
| Revocation Cache | 15 seconds | 120 seconds |
| Session TTL | 300 seconds max | - |
| Nonce Retention | Challenge TTL + 120 seconds | - |

### Clock Skew Tolerance

- Maximum allowed skew: +/- 120 seconds
- Skew detection applies before all timestamp validations
- High-risk operations fail-closed on clock skew issues

### Fail-Soft vs Fail-Closed

- **LOW-risk operations**: May use degraded mode with stale caches
- **HIGH-risk operations**: Must fail-closed if fresh data unavailable

## Usage

These test vectors are designed to:

1. Validate protocol implementations
2. Test edge cases and security scenarios
3. Ensure interoperability between implementations
4. Provide conformance test coverage

Implementation test suites should:

1. Load test vectors from JSON files
2. Execute inputs against implementation
3. Compare outputs with expected results
4. Report pass/fail with details for debugging

## Schema Version

- Test vector schema version: 0.2
- Protocol version: 0.2-draft