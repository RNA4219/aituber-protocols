/**
 * AITuber相互認証・交流プロトコル Client実装
 * エントリーポイント
 * @see ../../specs/core/interfaces.md
 */

// Types
export * from './types.js';

// Crypto utilities
export * from './crypto.js';

// Common utilities
export * from './utils.js';

// Proof Generator
export * from './proof-generator.js';

// Agent Client
export * from './agent-client.js';

// Exchange Client
export * from './exchange-client.js';

// Re-export main classes for convenience
export { AgentClient, createAgentClient, resolveAgentIdentity } from './agent-client.js';
export { ExchangeClient, createExchangeClient, createExchangeClientFromSession, buildHelloMessage, buildCollabInviteMessage } from './exchange-client.js';
export { ProofGeneratorImpl } from './proof-generator.js';