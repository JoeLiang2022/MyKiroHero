/**
 * Jest Custom Reporter - Fail Only
 * 
 * Only prints failed test details. Passed tests are silent.
 * Always prints a summary line at the end.
 */
class FailOnlyReporter {
  constructor(globalConfig) {
    this._globalConfig = globalConfig;
  }

  onTestResult(test, testResult) {
    const { testFilePath, testResults, failureMessage } = testResult;
    const relativePath = testFilePath.replace(process.cwd() + '\\', '').replace(process.cwd() + '/', '');

    const failed = testResults.filter(r => r.status === 'failed');

    if (failed.length > 0) {
      console.log(`\n FAIL ${relativePath}`);
      for (const t of failed) {
        console.log(`   ✕ ${t.ancestorTitles.join(' > ')}${t.ancestorTitles.length ? ' > ' : ''}${t.title}`);
        for (const msg of t.failureMessages) {
          // Indent each line of the failure message
          const indented = msg.split('\n').map(l => `     ${l}`).join('\n');
          console.log(indented);
        }
      }
    }
  }

  onRunComplete(contexts, results) {
    const { numPassedTests, numFailedTests, numTotalTests, numPassedTestSuites, numFailedTestSuites, numTotalTestSuites } = results;

    console.log('\n' + '─'.repeat(50));

    if (numFailedTests === 0) {
      console.log(`✓ All passed: ${numPassedTests} tests, ${numPassedTestSuites} suites`);
    } else {
      console.log(`✕ ${numFailedTests} failed, ${numPassedTests} passed (${numTotalTests} total)`);
      console.log(`  Suites: ${numFailedTestSuites} failed, ${numPassedTestSuites} passed (${numTotalTestSuites} total)`);
    }

    const elapsed = (Date.now() - results.startTime) / 1000;
    console.log(`  Time: ${elapsed.toFixed(1)}s`);
  }
}

module.exports = FailOnlyReporter;
