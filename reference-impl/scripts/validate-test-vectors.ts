/**
 * Test Vectors Validation Script for AITuber Protocols
 * Validates test vectors against expected schemas and checks structure
 */

import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Get current directory in ES module compatible way
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ANSI color codes for console output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bold: '\x1b[1m',
};

interface VectorResult {
  file: string;
  vectorId: string;
  vectorName: string;
  valid: boolean;
  errors?: string[];
  warnings?: string[];
}

interface VectorSummary {
  totalFiles: number;
  totalVectors: number;
  passed: number;
  failed: number;
  results: VectorResult[];
}

// Base directories
const SCHEMAS_DIR = path.resolve(__dirname, '../../schemas');
const TEST_VECTORS_DIR = path.resolve(__dirname, '../../test-vectors');

// Required fields for test vector structure
const REQUIRED_VECTOR_FIELDS = ['id', 'name', 'description', 'input', 'expected_output'];

// Vector type classification based on file path
type VectorType = 'auth' | 'replay' | 'rollback' | 'quarantine' | 'unknown';

// Core required fields for each component (missing = ERROR)
const INPUT_CORE_FIELDS: Record<string, string[]> = {
  'challenge': ['challenge_id', 'target_agent_id', 'nonce', 'issued_at'],
  'proof': ['agent_id', 'nonce', 'timestamp'],
  'identity_manifest': ['agent_id'],
  'session': ['session_id', 'agent_id'],
  'current_session': ['session_id', 'agent_id'],
};

// Recommended fields for each component (missing = WARNING)
const INPUT_RECOMMENDED_FIELDS: Record<string, string[]> = {
  'challenge': ['expires_at', 'verifier_session_pubkey', 'intent'],
  'proof': ['instance_id', 'signature', 'expires_at', 'intent'],
  'identity_manifest': ['controller_id', 'platform_bindings', 'operation_keys'],
  'session': ['issued_at', 'expires_at', 'session_status', 'session_epoch'],
  'current_session': ['issued_at', 'expires_at', 'session_status'],
};

// Required status fields for each vector type (missing = ERROR)
const REQUIRED_STATUS_FIELDS: Record<VectorType, string[]> = {
  'auth': [
    'verification_status', 'resolution_status', 'operation_status', 'operation_allowed',
    'session_status', 'bootstrap_status', 'recovery_status', 'message_valid',
    'old_session_status', 'new_session', 'collaboration_established', 'binding_match'
  ],
  'replay': [
    'verification_status', 'message_valid', 'operation_status', 'invite_status',
    'exchange_status', 'session_status'
  ],
  'rollback': [
    'verification_status', 'message_valid', 'watcher_alert', 'high_risk_allowed',
    'bootstrap_status'
  ],
  'quarantine': [
    'operation_status', 'recovery_status', 'quarantine_status', 'agent_status',
    'session_status', 'acceptance_status', 'exchange_status', 'update_status',
    'post_quarantine_state', 'new_quarantine_status'
  ],
  'unknown': [
    'verification_status', 'resolution_status', 'operation_status', 'operation_allowed',
    'message_valid', 'session_status', 'recovery_status', 'quarantine_status',
    'agent_status', 'invite_status', 'bootstrap_status', 'watcher_alert',
    'collaboration_established', 'binding_match'
  ],
};

/**
 * Determine vector type from file path
 */
function determineVectorType(filePath: string): VectorType {
  if (filePath.includes('/auth/') || filePath.includes('\\auth\\')) {
    return 'auth';
  } else if (filePath.includes('/replay/') || filePath.includes('\\replay\\')) {
    return 'replay';
  } else if (filePath.includes('/rollback/') || filePath.includes('\\rollback\\')) {
    return 'rollback';
  } else if (filePath.includes('/quarantine/') || filePath.includes('\\quarantine\\')) {
    return 'quarantine';
  }
  return 'unknown';
}

/**
 * Create AJV instance with all schemas loaded
 */
function createAjv(): Ajv {
  const ajv = new Ajv({
    strict: false,
    allErrors: true,
    validateFormats: true,
    validateSchema: false, // Don't validate schemas themselves, only data
    loadSchema: (uri: string) => {
      if (uri.startsWith('../')) {
        const schemaPath = path.resolve(SCHEMAS_DIR, uri.replace('../', ''));
        const content = fs.readFileSync(schemaPath, 'utf-8');
        return JSON.parse(content);
      }
      throw new Error(`Cannot load schema: ${uri}`);
    },
  });

  addFormats(ajv);

  return ajv;
}

/**
 * Load all schemas into AJV
 */
function loadAllSchemas(ajv: Ajv): void {
  // Core schema
  const coreSchemaPath = path.join(SCHEMAS_DIR, 'core/common.schema.json');
  if (fs.existsSync(coreSchemaPath)) {
    const coreSchema = JSON.parse(fs.readFileSync(coreSchemaPath, 'utf-8'));
    const schemaId = coreSchema.$id || 'https://example.org/schemas/core/common.schema.json';
    ajv.addSchema(coreSchema, schemaId);
    console.log(`${colors.cyan}Loaded:${colors.reset} core/common.schema.json`);
  }

  // Auth schemas
  const authDir = path.join(SCHEMAS_DIR, 'auth');
  if (fs.existsSync(authDir)) {
    const authFiles = fs.readdirSync(authDir).filter(f => f.endsWith('.schema.json'));
    for (const file of authFiles) {
      const schemaPath = path.join(authDir, file);
      const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
      const schemaId = schema.$id || `auth/${file}`;
      ajv.addSchema(schema, schemaId);
      console.log(`${colors.cyan}Loaded:${colors.reset} auth/${file}`);
    }
  }

  // Ledger schemas
  const ledgerDir = path.join(SCHEMAS_DIR, 'ledger');
  if (fs.existsSync(ledgerDir)) {
    const ledgerFiles = fs.readdirSync(ledgerDir).filter(f => f.endsWith('.schema.json'));
    for (const file of ledgerFiles) {
      const schemaPath = path.join(ledgerDir, file);
      const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
      const schemaId = schema.$id || `ledger/${file}`;
      ajv.addSchema(schema, schemaId);
      console.log(`${colors.cyan}Loaded:${colors.reset} ledger/${file}`);
    }
  }

  // Discovery schemas
  const discoveryDir = path.join(SCHEMAS_DIR, 'discovery');
  if (fs.existsSync(discoveryDir)) {
    const discoveryFiles = fs.readdirSync(discoveryDir).filter(f => f.endsWith('.schema.json'));
    for (const file of discoveryFiles) {
      const schemaPath = path.join(discoveryDir, file);
      const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
      const schemaId = schema.$id || `discovery/${file}`;
      ajv.addSchema(schema, schemaId);
      console.log(`${colors.cyan}Loaded:${colors.reset} discovery/${file}`);
    }
  }
}

/**
 * Validate test vector structure
 */
function validateVectorStructure(data: Record<string, unknown>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const field of REQUIRED_VECTOR_FIELDS) {
    if (!(field in data)) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // Validate input structure
  if (data.input && typeof data.input === 'object') {
    const input = data.input as Record<string, unknown>;

    // Check for at least one input component
    const inputKeys = Object.keys(input);
    if (inputKeys.length === 0) {
      errors.push('Input object is empty');
    }
  } else if (!data.input) {
    errors.push('Input field is missing or invalid');
  }

  // Validate expected_output structure
  if (data.expected_output && typeof data.expected_output === 'object') {
    const output = data.expected_output as Record<string, unknown>;
    const outputKeys = Object.keys(output);
    if (outputKeys.length === 0) {
      errors.push('Expected output object is empty');
    }
  } else if (!data.expected_output) {
    errors.push('Expected output field is missing or invalid');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate specific input components against their expected schemas
 * Core fields missing = ERROR (fails validation)
 * Recommended fields missing = WARNING (passes with warning)
 */
function validateInputComponents(
  ajv: Ajv,
  input: Record<string, unknown>
): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Validate challenge if present
  if (input.challenge) {
    const challenge = input.challenge as Record<string, unknown>;

    // Check core required fields
    const coreFields = INPUT_CORE_FIELDS.challenge;
    const missingCore = coreFields.filter(f => !(f in challenge));
    if (missingCore.length > 0) {
      errors.push(`Challenge missing core required fields: ${missingCore.join(', ')}`);
    }

    // Check recommended fields
    const recommendedFields = INPUT_RECOMMENDED_FIELDS.challenge;
    const missingRecommended = recommendedFields.filter(f => !(f in challenge));
    if (missingRecommended.length > 0) {
      warnings.push(`Challenge missing recommended fields: ${missingRecommended.join(', ')}`);
    }
  }

  // Validate proof if present
  if (input.proof) {
    const proof = input.proof as Record<string, unknown>;

    // Check core required fields
    const coreFields = INPUT_CORE_FIELDS.proof;
    const missingCore = coreFields.filter(f => !(f in proof));
    if (missingCore.length > 0) {
      errors.push(`Proof missing core required fields: ${missingCore.join(', ')}`);
    }

    // Check recommended fields
    const recommendedFields = INPUT_RECOMMENDED_FIELDS.proof;
    const missingRecommended = recommendedFields.filter(f => !(f in proof));
    if (missingRecommended.length > 0) {
      warnings.push(`Proof missing recommended fields: ${missingRecommended.join(', ')}`);
    }
  }

  // Validate identity_manifest if present
  if (input.identity_manifest) {
    const manifest = input.identity_manifest as Record<string, unknown>;

    // Check core required fields
    const coreFields = INPUT_CORE_FIELDS.identity_manifest;
    const missingCore = coreFields.filter(f => !(f in manifest));
    if (missingCore.length > 0) {
      errors.push(`Identity manifest missing core required fields: ${missingCore.join(', ')}`);
    }

    // Check recommended fields
    const recommendedFields = INPUT_RECOMMENDED_FIELDS.identity_manifest;
    const missingRecommended = recommendedFields.filter(f => !(f in manifest));
    if (missingRecommended.length > 0) {
      warnings.push(`Identity manifest missing recommended fields: ${missingRecommended.join(', ')}`);
    }
  }

  // Validate session if present (check both 'session' and 'current_session')
  const sessionKeys = ['current_session', 'session'] as const;
  for (const key of sessionKeys) {
    if (input[key]) {
      const session = input[key] as Record<string, unknown>;

      // Check core required fields
      const coreFields = INPUT_CORE_FIELDS[key] || INPUT_CORE_FIELDS.session;
      const missingCore = coreFields.filter(f => !(f in session));
      if (missingCore.length > 0) {
        errors.push(`${key} missing core required fields: ${missingCore.join(', ')}`);
      }

      // Check recommended fields
      const recommendedFields = INPUT_RECOMMENDED_FIELDS[key] || INPUT_RECOMMENDED_FIELDS.session;
      const missingRecommended = recommendedFields.filter(f => !(f in session));
      if (missingRecommended.length > 0) {
        warnings.push(`${key} missing recommended fields: ${missingRecommended.join(', ')}`);
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate expected output structure
 * Missing status field = ERROR (fails validation)
 */
function validateExpectedOutput(
  output: Record<string, unknown>,
  vectorType: VectorType
): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check for required status fields based on vector type
  const requiredStatusFields = REQUIRED_STATUS_FIELDS[vectorType];
  const hasStatusField = requiredStatusFields.some(field => field in output);

  if (!hasStatusField) {
    errors.push(
      `Expected output missing required status field for ${vectorType} vector. ` +
      `Expected one of: ${requiredStatusFields.join(', ')}`
    );
  }

  // Check for error object when status indicates failure
  const failureStatuses = ['REJECTED', 'TERMINATED', 'EXPIRED', 'REVOKED', 'INVALID', 'FAILED'];
  const statusField = requiredStatusFields.find(field => field in output);

  if (statusField && output[statusField]) {
    const statusValue = output[statusField];
    if (typeof statusValue === 'string' && failureStatuses.some(s => statusValue.includes(s))) {
      if (!('error' in output) && !('errors' in output)) {
        warnings.push('Expected output has failure status but no error/errors field');
      }
    }
  }

  // Validate version_check if present (as warnings, not errors)
  if (output.version_check && typeof output.version_check === 'object') {
    const versionCheck = output.version_check as Record<string, unknown>;
    const expectedFields = ['rollback_detected', 'epoch_mismatch', 'session_epoch_old', 'policy_mismatch'];
    for (const field of expectedFields) {
      if (!(field in versionCheck)) {
        warnings.push(`Version check missing field: ${field}`);
      }
    }
  }

  // Check for new_session when session renewal is expected
  if ('old_session_status' in output && !('new_session' in output)) {
    warnings.push('Session renewal output missing new_session field');
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Process a single test vector file
 */
function processVectorFile(
  ajv: Ajv,
  filePath: string
): VectorResult[] {
  const results: VectorResult[] = [];
  const relativePath = path.relative(TEST_VECTORS_DIR, filePath);

  // Determine vector type from file path
  const vectorType = determineVectorType(filePath);

  console.log(`\n${colors.white}Processing:${colors.reset} ${relativePath} (${colors.cyan}${vectorType}${colors.reset})`);

  try {
    const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

    // Check if it has a vectors array (batch file)
    if (content.vectors && Array.isArray(content.vectors)) {
      for (const vector of content.vectors) {
        const result = validateSingleVector(ajv, vector, `${relativePath}#${vector.id || 'unknown'}`, vectorType);
        results.push(result);
      }
    } else if (content.id) {
      // Single vector file
      const result = validateSingleVector(ajv, content, relativePath, vectorType);
      results.push(result);
    } else {
      console.log(`  ${colors.yellow}No vectors found in file${colors.reset}`);
    }
  } catch (error) {
    console.log(`  ${colors.red}Error reading file:${colors.reset} ${(error as Error).message}`);
  }

  return results;
}

/**
 * Validate a single test vector
 */
function validateSingleVector(
  ajv: Ajv,
  vector: Record<string, unknown>,
  identifier: string,
  vectorType: VectorType
): VectorResult {
  const vectorId = (vector.id as string) || 'unknown';
  const vectorName = (vector.name as string) || 'unnamed';

  // Validate structure
  const structureResult = validateVectorStructure(vector);

  // Validate input components
  const inputResult = vector.input
    ? validateInputComponents(ajv, vector.input as Record<string, unknown>)
    : { valid: false, errors: ['Missing input'], warnings: [] };

  // Validate expected output
  const outputResult = vector.expected_output
    ? validateExpectedOutput(vector.expected_output as Record<string, unknown>, vectorType)
    : { valid: false, errors: ['Missing expected_output'], warnings: [] };

  const allErrors = [
    ...structureResult.errors,
    ...inputResult.errors,
    ...outputResult.errors,
  ];

  const allWarnings = [
    ...inputResult.warnings,
    ...outputResult.warnings,
  ];

  const valid = allErrors.length === 0;

  // Print result
  if (valid) {
    console.log(`  ${colors.green}Vector ${vectorId}:${colors.reset} ${vectorName} ${colors.green}PASSED${colors.reset}`);
    if (allWarnings.length > 0) {
      for (const warning of allWarnings) {
        console.log(`    ${colors.yellow}Warning:${colors.reset} ${warning}`);
      }
    }
  } else {
    console.log(`  ${colors.red}Vector ${vectorId}:${colors.reset} ${vectorName} ${colors.red}FAILED${colors.reset}`);
    for (const error of allErrors) {
      console.log(`    ${colors.red}Error:${colors.reset} ${error}`);
    }
    if (allWarnings.length > 0) {
      for (const warning of allWarnings) {
        console.log(`    ${colors.yellow}Warning:${colors.reset} ${warning}`);
      }
    }
  }

  return {
    file: identifier,
    vectorId,
    vectorName,
    valid,
    errors: allErrors.length > 0 ? allErrors : undefined,
    warnings: allWarnings.length > 0 ? allWarnings : undefined,
  };
}

/**
 * Validate all test vectors
 */
export async function validateTestVectors(): Promise<VectorSummary> {
  console.log(`\n${colors.bold}${colors.blue}=== Test Vectors Validation ===${colors.reset}\n`);

  const ajv = createAjv();
  loadAllSchemas(ajv);

  const summary: VectorSummary = {
    totalFiles: 0,
    totalVectors: 0,
    passed: 0,
    failed: 0,
    results: [],
  };

  // Recursively find all JSON files in test-vectors directory
  function findJsonFiles(dir: string): string[] {
    const files: string[] = [];
    if (!fs.existsSync(dir)) return files;

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...findJsonFiles(fullPath));
      } else if (entry.name.endsWith('.json')) {
        files.push(fullPath);
      }
    }
    return files;
  }

  const vectorFiles = findJsonFiles(TEST_VECTORS_DIR);
  summary.totalFiles = vectorFiles.length;

  console.log(`\n${colors.cyan}Found ${vectorFiles.length} test vector files${colors.reset}\n`);

  for (const file of vectorFiles) {
    const results = processVectorFile(ajv, file);
    summary.results.push(...results);
    summary.totalVectors += results.length;
    summary.passed += results.filter(r => r.valid).length;
    summary.failed += results.filter(r => !r.valid).length;
  }

  return summary;
}

/**
 * Print validation summary
 */
export function printSummary(summary: VectorSummary): void {
  console.log(`\n${colors.bold}=== Test Vectors Summary ===${colors.reset}\n`);
  console.log(`Total files: ${summary.totalFiles}`);
  console.log(`Total vectors: ${summary.totalVectors}`);
  console.log(`${colors.green}Passed:${colors.reset} ${summary.passed}`);
  console.log(`${colors.red}Failed:${colors.reset} ${summary.failed}`);

  if (summary.failed > 0) {
    console.log(`\n${colors.bold}${colors.red}Failed Vectors:${colors.reset}`);
    for (const result of summary.results.filter(r => !r.valid)) {
      console.log(`\n${colors.red}${result.file}${colors.reset}`);
      console.log(`  Vector: ${result.vectorId} - ${result.vectorName}`);
      if (result.errors) {
        for (const err of result.errors) {
          console.log(`  - ${err}`);
        }
      }
    }
  }
}

// Run validation if executed directly (ES module compatible)
validateTestVectors()
  .then(summary => {
    printSummary(summary);
    process.exit(summary.failed > 0 ? 1 : 0);
  })
  .catch(error => {
    console.error(`${colors.red}Fatal error:${colors.reset}`, error);
    process.exit(1);
  });