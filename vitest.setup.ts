import { config } from 'dotenv';
import path from 'path';

// Load test environment variables
config({ path: path.resolve(__dirname, '.env.test') });

// Extend expect with jest-dom matchers (for React component testing)
import '@testing-library/jest-dom/vitest';
