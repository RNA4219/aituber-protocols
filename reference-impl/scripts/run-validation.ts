/**
 * Integrated Validation Script for AITuber Protocols
 * Runs all validation checks and reports combined results
 */

import { validateExamples, printSummary as printExamplesSummary } from './validate-schemas';
import { validateTestVectors, printSummary as printVectorsSummary } from './validate-test-vectors';

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
  dim: '\x1b[2m',
};

interface OverallSummary {
  examplesPassed: boolean;
  vectorsPassed: boolean;
  totalErrors: number;
  executionTimeMs: number;
}

/**
 * Print a section header
 */
function printHeader(title: string): void {
  console.log(`\n${colors.bold}${colors.blue}${'='.repeat(60)}${colors.reset}`);
  console.log(`${colors.bold}${colors.blue}  ${title}${colors.reset}`);
  console.log(`${colors.bold}${colors.blue}${'='.repeat(60)}${colors.reset}\n`);
}

/**
 * Print overall results
 */
function printOverallResults(summary: OverallSummary): void {
  console.log(`\n${colors.bold}${colors.blue}${'='.repeat(60)}${colors.reset}`);
  console.log(`${colors.bold}${colors.blue}  OVERALL RESULTS${colors.reset}`);
  console.log(`${colors.bold}${colors.blue}${'='.repeat(60)}${colors.reset}\n`);

  console.log(`Execution time: ${summary.executionTimeMs}ms`);
  console.log(`Total errors: ${summary.totalErrors}`);

  const status = summary.examplesPassed && summary.vectorsPassed;
  const statusText = status ? `${colors.green}PASSED${colors.reset}` : `${colors.red}FAILED${colors.reset}`;
  console.log(`\nOverall Status: ${statusText}`);

  console.log(`\n${colors.dim}Breakdown:${colors.reset}`);
  console.log(`  Examples validation: ${summary.examplesPassed ? `${colors.green}PASSED${colors.reset}` : `${colors.red}FAILED${colors.reset}`}`);
  console.log(`  Test vectors validation: ${summary.vectorsPassed ? `${colors.green}PASSED${colors.reset}` : `${colors.red}FAILED${colors.reset}`}`);

  console.log(`\n${colors.bold}${colors.blue}${'='.repeat(60)}${colors.reset}\n`);
}

/**
 * Run all validations
 */
async function runAllValidations(): Promise<OverallSummary> {
  const startTime = Date.now();
  let examplesFailed = 0;
  let vectorsFailed = 0;

  // Validate Examples
  printHeader('Validating Examples');
  try {
    const examplesSummary = await validateExamples();
    printExamplesSummary(examplesSummary);
    examplesFailed = examplesSummary.failed;
  } catch (error) {
    console.error(`${colors.red}Error validating examples:${colors.reset}`, error);
    examplesFailed = 1;
  }

  // Validate Test Vectors
  printHeader('Validating Test Vectors');
  try {
    const vectorsSummary = await validateTestVectors();
    printVectorsSummary(vectorsSummary);
    vectorsFailed = vectorsSummary.failed;
  } catch (error) {
    console.error(`${colors.red}Error validating test vectors:${colors.reset}`, error);
    vectorsFailed = 1;
  }

  const executionTimeMs = Date.now() - startTime;

  return {
    examplesPassed: examplesFailed === 0,
    vectorsPassed: vectorsFailed === 0,
    totalErrors: examplesFailed + vectorsFailed,
    executionTimeMs,
  };
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  console.log(`\n${colors.bold}${colors.cyan}AITuber Protocols - Schema Validation${colors.reset}`);
  console.log(`${colors.dim}Running comprehensive validation checks...${colors.reset}`);

  try {
    const summary = await runAllValidations();
    printOverallResults(summary);

    // Exit with appropriate code
    const exitCode = summary.totalErrors > 0 ? 1 : 0;
    process.exit(exitCode);
  } catch (error) {
    console.error(`${colors.red}Fatal error:${colors.reset}`, error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

export { runAllValidations, printOverallResults };