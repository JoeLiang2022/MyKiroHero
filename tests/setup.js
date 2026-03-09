/**
 * Jest Setup File for MyKiroHero
 * 
 * This file runs before each test file.
 * Configure global test settings and utilities here.
 */

// Increase timeout for property-based tests
// fast-check runs 100+ iterations per property
jest.setTimeout(30000);

// Global test utilities
global.testUtils = {
  // Helper to generate ISO timestamp
  isoTimestamp: () => new Date().toISOString(),
  
  // Helper to generate session ID (YYYYMMDD-NNN format)
  sessionId: (date = new Date(), num = 1) => {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const nnn = String(num).padStart(3, '0');
    return `${yyyy}${mm}${dd}-${nnn}`;
  },
  
  // Helper to format date as YYYY-MM-DD
  dateString: (date = new Date()) => {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
};

// Suppress console output during tests (optional, can be removed if needed)
// global.console = {
//   ...console,
//   log: jest.fn(),
//   debug: jest.fn(),
//   info: jest.fn(),
//   warn: jest.fn(),
// };
