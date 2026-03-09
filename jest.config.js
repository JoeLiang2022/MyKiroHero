/**
 * Jest Configuration for MyKiroHero
 * 
 * Property-based testing uses fast-check library
 * Minimum 100 iterations per property test as per design spec
 */
module.exports = {
  // Test environment
  testEnvironment: 'node',
  
  // Test file patterns
  testMatch: [
    '**/tests/**/*.test.js',
    '**/src/**/*.test.js'
  ],

  // Exclude node:test files (run separately with `node --test`)
  testPathIgnorePatterns: [
    '/node_modules/',
    'detect-provider\\.test\\.js',
    'task-queue\\.test\\.js',
    'task-executor\\.test\\.js',
    'server-task-endpoints\\.test\\.js',
    'server-worker-reset\\.test\\.js'
  ],
  
  // Coverage configuration
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/**/*.test.js',
    '!**/node_modules/**'
  ],
  
  // Coverage thresholds (can be adjusted as needed)
  coverageThreshold: {
    global: {
      branches: 50,
      functions: 50,
      lines: 50,
      statements: 50
    }
  },
  
  // Test timeout (increased for property-based tests)
  testTimeout: 30000,
  
  // Use fail-only reporter (only prints failed tests, silent on pass)
  reporters: ['<rootDir>/tests/fail-only-reporter.js'],
  
  // Verbose output (used by default reporter, fail-only reporter ignores this)
  verbose: true,
  
  // Clear mocks between tests
  clearMocks: true,
  
  // Setup files
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js']
};
