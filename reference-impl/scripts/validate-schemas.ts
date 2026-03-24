/**
 * Schema Validation Script for AITuber Protocols
 * Validates all examples against their respective JSON schemas using AJV
 */

import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import * as fs from 'fs';
import * as path from 'path';

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

interface ValidationResult {
  file: string;
  schema: string | null;
  valid: boolean;
  errors?: string[];
  source?: MessageSource;
  stepNumber?: number;
  schemaDetermined: boolean;
}

interface FileStats {
  file: string;
  total: number;
  validated: number;
  skipped: number;
  passed: number;
  failed: number;
}

interface ValidationSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  results: ValidationResult[];
  fileStats: FileStats[];
  undeterminedSchemas: Array<{ file: string; source: MessageSource; stepNumber?: number; keys: string[] }>;
}

// Base directories
const SCHEMAS_DIR = path.resolve(__dirname, '../../schemas');
const EXAMPLES_DIR = path.resolve(__dirname, '../../examples');

// Map message_type values to exchange schema files
const MESSAGE_TYPE_TO_SCHEMA: Record<string, string> = {
  'hello': 'exchange/hello.schema.json',
  'goodbye': 'exchange/goodbye.schema.json',
  'message': 'exchange/message.schema.json',
  'error': 'exchange/error.schema.json',
};

// Map event types to schema files
const EVENT_TYPE_TO_SCHEMA: Record<string, string> = {
  'key.revoked': 'ledger/key-revoked.schema.json',
  'binding.updated': 'ledger/binding-updated.schema.json',
  'compromise.reported': 'ledger/compromise-reported.schema.json',
  'agent.quarantined': 'ledger/agent-quarantined.schema.json',
  'recovery.initiated': 'ledger/recovery-initiated.schema.json',
  'recovery.completed': 'ledger/recovery-completed.schema.json',
};

// Schema file to schema name mapping for detection
// Each entry has a list of identifying fields (must have at least 3 to match)
const SCHEMA_DETECTION: Record<string, string[]> = {
  'auth/challenge.schema.json': ['challenge_id', 'verifier_id', 'target_agent_id', 'nonce', 'intent', 'risk_level'],
  'auth/proof.schema.json': ['proof_id', 'challenge_id', 'session_pubkey'],
  'auth/identity-manifest.schema.json': ['manifest_version', 'controller_id', 'platform_bindings'],
  'auth/session.schema.json': ['session_id', 'session_epoch'],
  'auth/revocation-status.schema.json': ['agent_status', 'quarantine_status', 'high_risk_eligible'],
  'ledger/event-envelope.schema.json': ['event_id', 'event_type', 'payload', 'sequence', 'payload_hash'],
};

// Unique identifiers that definitively identify a schema
const UNIQUE_IDENTIFIERS: Record<string, string> = {
  'proof_id': 'auth/proof.schema.json',
  'session_id': 'auth/session.schema.json',
  'manifest_version': 'auth/identity-manifest.schema.json',
  'agent_status': 'auth/revocation-status.schema.json',
  'event_type': 'ledger/event-envelope.schema.json',
};

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
      // Handle relative refs
      if (uri.startsWith('../')) {
        const schemaPath = path.resolve(SCHEMAS_DIR, uri.replace('../', ''));
        const content = fs.readFileSync(schemaPath, 'utf-8');
        return JSON.parse(content);
      }
      throw new Error(`Cannot load schema: ${uri}`);
    },
  });

  // Add format validation (date-time, uri, etc.)
  addFormats(ajv);

  return ajv;
}

/**
 * Load all schema files from the schemas directory
 */
function loadAllSchemas(ajv: Ajv): Map<string, object> {
  const schemaMap = new Map<string, object>();

  // Core schema
  const coreSchemaPath = path.join(SCHEMAS_DIR, 'core/common.schema.json');
  if (fs.existsSync(coreSchemaPath)) {
    const coreSchema = JSON.parse(fs.readFileSync(coreSchemaPath, 'utf-8'));
    const schemaId = coreSchema.$id || 'https://example.org/schemas/core/common.schema.json';
    ajv.addSchema(coreSchema, schemaId);
    schemaMap.set('core/common.schema.json', coreSchema);
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
      schemaMap.set(`auth/${file}`, schema);
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
      schemaMap.set(`ledger/${file}`, schema);
      console.log(`${colors.cyan}Loaded:${colors.reset} ledger/${file}`);
    }
  }

  // Exchange schemas
  const exchangeDir = path.join(SCHEMAS_DIR, 'exchange');
  if (fs.existsSync(exchangeDir)) {
    const exchangeFiles = fs.readdirSync(exchangeDir).filter(f => f.endsWith('.schema.json'));
    for (const file of exchangeFiles) {
      const schemaPath = path.join(exchangeDir, file);
      const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
      const schemaId = schema.$id || `exchange/${file}`;
      ajv.addSchema(schema, schemaId);
      schemaMap.set(`exchange/${file}`, schema);
      console.log(`${colors.cyan}Loaded:${colors.reset} exchange/${file}`);
    }
  }

  return schemaMap;
}

/**
 * Detect which schema to use for a given JSON object
 */
function detectSchema(data: Record<string, unknown>): string | null {
  const keys = Object.keys(data);

  // Check for exchange protocol messages (message_type based detection)
  if (keys.includes('message_type') && keys.includes('message_id')) {
    const messageType = data.message_type as string;
    if (messageType && MESSAGE_TYPE_TO_SCHEMA[messageType]) {
      return MESSAGE_TYPE_TO_SCHEMA[messageType];
    }
    // Unknown message_type - will be reported as failure
    return null;
  }

  // Check for unique identifiers first (definitive identification)
  for (const [uniqueField, schemaFile] of Object.entries(UNIQUE_IDENTIFIERS)) {
    if (keys.includes(uniqueField)) {
      // Special case: event_type is only definitive when combined with event_id and payload
      if (uniqueField === 'event_type') {
        if (data.event_id && data.payload) {
          return schemaFile;
        }
      } else {
        return schemaFile;
      }
    }
  }

  // Fallback: Check each schema's identifying fields
  // This handles cases like challenge which don't have a unique identifier
  for (const [schemaFile, identifyingFields] of Object.entries(SCHEMA_DETECTION)) {
    const matchCount = identifyingFields.filter(field => keys.includes(field)).length;
    if (matchCount >= 3) {
      return schemaFile;
    }
  }

  // Check for specific patterns
  if (keys.includes('flow') && keys.includes('steps')) {
    return null; // Flow file, not a direct schema match
  }

  return null;
}

/**
 * Validate a single JSON object against a schema
 */
function validateObject(
  ajv: Ajv,
  data: Record<string, unknown>,
  schemaFile: string
): { valid: boolean; errors?: string[] } {
  const schemaPath = path.join(SCHEMAS_DIR, schemaFile);
  if (!fs.existsSync(schemaPath)) {
    return { valid: false, errors: [`Schema file not found: ${schemaFile}`] };
  }

  try {
    // Read schema to get its $id
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
    const schemaId = schema.$id || schemaFile;

    // Try to get already compiled schema, or compile it
    let validate = ajv.getSchema(schemaId);
    if (!validate) {
      validate = ajv.compile(schema);
    }

    const valid = validate(data);

    if (!valid && validate.errors) {
      const errors = validate.errors.map(err =>
        `${err.instancePath || '/'} ${err.message || 'validation failed'}`
      );
      return { valid: false, errors };
    }

    return { valid: true };
  } catch (error) {
    return { valid: false, errors: [(error as Error).message] };
  }
}

/**
 * Source of a message in an example file
 */
type MessageSource = 'message' | 'request' | 'response' | 'direct';

/**
 * Process an example file and extract messages to validate
 */
function processExampleFile(filePath: string): Array<{ data: Record<string, unknown>; schema: string | null; source: MessageSource; stepNumber?: number }> {
  const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const messages: Array<{ data: Record<string, unknown>; schema: string | null; source: MessageSource; stepNumber?: number }> = [];

  // Check if it's a flow file with steps
  if (content.steps && Array.isArray(content.steps)) {
    for (const step of content.steps) {
      const stepNumber = step.step_number || step.step;

      // Process step.message
      if (step.message) {
        const schema = detectSchema(step.message);
        messages.push({ data: step.message, schema, source: 'message', stepNumber });
      }

      // Process step.request
      if (step.request) {
        const schema = detectSchema(step.request);
        messages.push({ data: step.request, schema, source: 'request', stepNumber });
      }

      // Process step.response
      if (step.response) {
        const schema = detectSchema(step.response);
        messages.push({ data: step.response, schema, source: 'response', stepNumber });
      }
    }
  }

  // Check for direct message objects (standalone files, not flow files)
  if (content.challenge_id || content.proof_id || content.session_id || content.event_type || content.message_type) {
    const schema = detectSchema(content);
    messages.push({ data: content, schema, source: 'direct' });
  }

  return messages;
}

/**
 * Validate all examples
 */
export async function validateExamples(): Promise<ValidationSummary> {
  console.log(`\n${colors.bold}${colors.blue}=== Schema Validation for Examples ===${colors.reset}\n`);

  const ajv = createAjv();
  loadAllSchemas(ajv);

  const summary: ValidationSummary = {
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    results: [],
    fileStats: [],
    undeterminedSchemas: [],
  };

  // Recursively find all JSON files in examples directory
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

  const exampleFiles = findJsonFiles(EXAMPLES_DIR);
  console.log(`\n${colors.cyan}Found ${exampleFiles.length} example files${colors.reset}\n`);

  for (const file of exampleFiles) {
    const relativePath = path.relative(EXAMPLES_DIR, file);
    console.log(`${colors.white}Processing:${colors.reset} ${relativePath}`);

    const fileStats: FileStats = {
      file: relativePath,
      total: 0,
      validated: 0,
      skipped: 0,
      passed: 0,
      failed: 0,
    };

    try {
      const messages = processExampleFile(file);

      if (messages.length === 0) {
        console.log(`  ${colors.yellow}No validatable messages found${colors.reset}`);
        summary.fileStats.push(fileStats);
        continue;
      }

      fileStats.total = messages.length;

      for (let i = 0; i < messages.length; i++) {
        const { data, schema, source, stepNumber } = messages[i];
        const locationInfo = stepNumber ? `step ${stepNumber} ${source}` : source;
        summary.total++;

        if (!schema) {
          // Schema could not be determined - treat as failure
          summary.failed++;
          summary.skipped++;
          fileStats.skipped++;
          fileStats.failed++;

          const keys = Object.keys(data);
          summary.undeterminedSchemas.push({
            file: relativePath,
            source,
            stepNumber,
            keys,
          });

          console.log(`  ${colors.red}Message ${i + 1} (${locationInfo}): Could not determine schema - FAILURE${colors.reset}`);
          console.log(`    ${colors.red}Keys:${colors.reset} ${keys.join(', ')}`);

          const resultItem: ValidationResult = {
            file: `${relativePath}#${locationInfo}[${i}]`,
            schema: null,
            valid: false,
            errors: ['Could not determine schema for this object'],
            source,
            stepNumber,
            schemaDetermined: false,
          };
          summary.results.push(resultItem);
          continue;
        }

        fileStats.validated++;
        const result = validateObject(ajv, data, schema);
        const resultItem: ValidationResult = {
          file: `${relativePath}#${locationInfo}[${i}]`,
          schema,
          valid: result.valid,
          errors: result.errors,
          source,
          stepNumber,
          schemaDetermined: true,
        };
        summary.results.push(resultItem);

        if (result.valid) {
          summary.passed++;
          fileStats.passed++;
          console.log(`  ${colors.green}Message ${i + 1} (${locationInfo}):${colors.reset} ${schema} ${colors.green}PASSED${colors.reset}`);
        } else {
          summary.failed++;
          fileStats.failed++;
          console.log(`  ${colors.red}Message ${i + 1} (${locationInfo}):${colors.reset} ${schema} ${colors.red}FAILED${colors.reset}`);
          if (result.errors) {
            for (const err of result.errors) {
              console.log(`    ${colors.red}Error:${colors.reset} ${err}`);
            }
          }
        }
      }
    } catch (error) {
      console.log(`  ${colors.red}Error processing file:${colors.reset} ${(error as Error).message}`);
    }

    // Output file statistics
    console.log(`  ${colors.cyan}Stats:${colors.reset} total=${fileStats.total}, validated=${fileStats.validated}, skipped=${fileStats.skipped}, passed=${fileStats.passed}, failed=${fileStats.failed}`);
    summary.fileStats.push(fileStats);
  }

  return summary;
}

/**
 * Print validation summary
 */
export function printSummary(summary: ValidationSummary): void {
  console.log(`\n${colors.bold}=== Validation Summary ===${colors.reset}\n`);
  console.log(`Total messages: ${summary.total}`);
  console.log(`${colors.green}Passed:${colors.reset} ${summary.passed}`);
  console.log(`${colors.red}Failed:${colors.reset} ${summary.failed}`);
  console.log(`${colors.yellow}Skipped (no schema):${colors.reset} ${summary.skipped}`);

  // Print undetermined schemas list
  if (summary.undeterminedSchemas.length > 0) {
    console.log(`\n${colors.bold}${colors.red}Objects with Undetermined Schemas:${colors.reset}`);
    for (const item of summary.undeterminedSchemas) {
      const locationInfo = item.stepNumber ? `step ${item.stepNumber} ${item.source}` : item.source;
      console.log(`\n${colors.red}${item.file} (${locationInfo})${colors.reset}`);
      console.log(`  ${colors.yellow}Keys:${colors.reset} ${item.keys.join(', ')}`);
    }
  }

  if (summary.failed > 0) {
    console.log(`\n${colors.bold}${colors.red}Failed Validations:${colors.reset}`);
    for (const result of summary.results.filter(r => !r.valid)) {
      console.log(`\n${colors.red}${result.file}${colors.reset}`);
      if (result.schema) {
        console.log(`  Schema: ${result.schema}`);
      } else {
        console.log(`  Schema: ${colors.yellow}(not determined)${colors.reset}`);
      }
      if (result.errors) {
        for (const err of result.errors) {
          console.log(`  - ${err}`);
        }
      }
    }
  }

  // Print file statistics summary
  console.log(`\n${colors.bold}=== File Statistics ===${colors.reset}\n`);
  for (const stats of summary.fileStats) {
    const statusColor = stats.failed > 0 ? colors.red : (stats.passed > 0 ? colors.green : colors.yellow);
    console.log(`${statusColor}${stats.file}:${colors.reset} total=${stats.total}, validated=${stats.validated}, skipped=${stats.skipped}, passed=${stats.passed}, failed=${stats.failed}`);
  }
}

// Run validation if executed directly
if (require.main === module) {
  validateExamples()
    .then(summary => {
      printSummary(summary);
      process.exit(summary.failed > 0 ? 1 : 0);
    })
    .catch(error => {
      console.error(`${colors.red}Fatal error:${colors.reset}`, error);
      process.exit(1);
    });
}