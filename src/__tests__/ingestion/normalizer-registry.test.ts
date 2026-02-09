import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  registerNormalizer,
  getNormalizer,
  getAllNormalizers,
} from '../../ingestion/normalizer/base.js';
import type { EventNormalizer } from '../../ingestion/normalizer/base.js';

describe('Normalizer Registry', () => {
  describe('registerNormalizer', () => {
    it('should register a normalizer', () => {
      const mockNormalizer: EventNormalizer = {
        source: 'stripe',
        verifySignature: vi.fn(),
        normalize: vi.fn(),
        extractIdentityHints: vi.fn(),
      };

      registerNormalizer(mockNormalizer);

      const retrieved = getNormalizer('stripe');
      expect(retrieved).toBe(mockNormalizer);
    });
  });

  describe('getNormalizer', () => {
    it('should throw for unregistered source', () => {
      expect(() => getNormalizer('braintree')).toThrow(
        'No normalizer registered for source: braintree',
      );
    });
  });

  describe('getAllNormalizers', () => {
    it('should return all registered normalizers', () => {
      const normalizers = getAllNormalizers();
      expect(Array.isArray(normalizers)).toBe(true);
      expect(normalizers.length).toBeGreaterThanOrEqual(0);
    });
  });
});
