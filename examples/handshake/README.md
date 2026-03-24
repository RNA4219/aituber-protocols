# Challenge-Response Authentication Handshake Examples

AITuber Protocol v0.2-draft

## Overview

This directory contains example JSON files demonstrating the challenge-response authentication handshake flow defined in the AITuber Protocol specification.

## Files

| File | Description |
|------|-------------|
| `low-risk-flow.json` | Complete authentication flow for low-risk operations |
| `high-risk-flow.json` | Complete authentication flow for high-risk operations |
| `failure-examples.json` | Collection of authentication failure scenarios with error codes |

## Authentication Flow Summary

```
┌─────────────────────────────────────────────────────────────────┐
│                    Challenge-Response Flow                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. Discovery          Agent A discovers Agent B via platform   │
│         │                                                       │
│         ▼                                                       │
│  2. Challenge Issue    Verifier (B) issues challenge with nonce │
│         │                                                       │
│         ▼                                                       │
│  3. Proof Response     Agent (A) signs challenge with key       │
│         │                                                       │
│         ▼                                                       │
│  4. Verification       Verifier validates signature, epochs     │
│         │                                                       │
│         ▼                                                       │
│  5. Session Issue      Verifier creates authenticated session   │
│         │                                                       │
│         ▼                                                       │
│  6. Exchange           Parties communicate via exchange layer   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Low-Risk vs High-Risk Authentication

### Low-Risk Authentication

**Characteristics:**
- Target operations: `chat.basic`, `profile.read`, `status.share`
- Stale revocation cache is acceptable
- Fail-soft when identity host is unreachable
- Capability downgrade allowed
- Faster verification (< 5 seconds target)

**Validation Requirements:**
- Valid signature
- Nonce not reused
- Timestamp within tolerance
- Binding integrity
- Agent not in `QUARANTINED_HARD` state

### High-Risk Authentication

**Characteristics:**
- Target operations: `collab.accept`, `memory.exchange`, capability upgrade, binding changes
- Fresh revocation proof is **MANDATORY**
- Fail-closed on any validation issues
- Identity host must be reachable
- All epochs must be current

**Additional Validation Requirements:**
- Fresh revocation proof obtained within freshness window
- No epoch regression (rollback detection)
- Agent not in any quarantine state
- Policy/capability match
- Ledger checkpoint consistency

## Error Codes

| Error Code | Description | Severity | Failure Type |
|------------|-------------|----------|--------------|
| `INVALID_SIGNATURE` | Signature verification failed | Critical | Both |
| `NONCE_EXPIRED` | Challenge nonce has expired | Warning | Both |
| `NONCE_REUSED` | Nonce was already used | Critical | Both |
| `TIMESTAMP_INVALID` | Timestamp outside tolerance | Warning | Both |
| `KEY_REVOKED` | Signing key has been revoked | Critical | Both |
| `BINDING_MISMATCH` | Platform binding mismatch | Critical | Both |
| `POLICY_MISMATCH` | Capability policy mismatch | Warning | Both |
| `STALE_REVOCATION_CACHE` | Revocation cache is stale | High | High-risk only |
| `SESSION_EPOCH_OLD` | Session epoch is outdated | Medium | Both |
| `IDENTITY_ROLLBACK_DETECTED` | Identity version regression | Critical | Both |
| `AGENT_QUARANTINED` | Agent is in quarantine state | High | Depends on level |

## Epoch Management

The protocol uses monotonic epochs to prevent rollback attacks:

| Epoch Type | Purpose | Incremented On |
|------------|---------|----------------|
| `identity_version` | Agent identity updates | Key rotation, binding changes, recovery |
| `revocation_epoch` | Revocation events | Key revocation, compromise reported |
| `policy_epoch` | Policy changes | Capability policy updates |
| `session_epoch` | Session invalidation | Policy epoch increase, re-auth required |

**Monotonic Rule:** Any epoch value lower than the previously seen value indicates a potential rollback attack and results in rejection.

## Session States

| State | Description |
|-------|-------------|
| `active` | Normal operation |
| `renewing` | Session renewal in progress |
| `reauth_required` | Re-authentication required for continued use |
| `expired` | Session time-to-live exceeded |
| `terminated` | Session explicitly terminated |

## Quarantine States

| State | Low-Risk | High-Risk |
|-------|----------|-----------|
| `ACTIVE` | Allowed | Allowed |
| `DEGRADED` | Allowed (limited) | Re-auth required |
| `QUARANTINED_SOFT` | Allowed (limited) | Rejected |
| `QUARANTINED_HARD` | Rejected | Rejected |
| `RECOVERING` | Rejected | Rejected |
| `SUSPENDED` | Rejected | Rejected |

## Related Schema Files

- `schemas/auth/challenge.schema.json` - Challenge message structure
- `schemas/auth/proof.schema.json` - Proof message structure
- `schemas/auth/session.schema.json` - Session token structure
- `schemas/core/common.schema.json` - Common type definitions

## Related Specification Documents

- `specs/core/requirements.md` - Protocol requirements
- `specs/auth/state-machine.md` - State machine definitions
- `specs/auth/cache-and-freshness.md` - Cache and freshness rules

## Usage Notes

These examples are for reference and testing purposes. In production:

1. Use cryptographically secure nonces (minimum 16 characters, recommended 32+)
2. Implement proper key storage and rotation procedures
3. Configure appropriate freshness windows based on security requirements
4. Log all authentication events to the transparency ledger
5. Monitor for replay attacks and suspicious patterns