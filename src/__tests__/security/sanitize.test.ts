import { describe, it, expect } from 'vitest';
import { sanitizePayload, sanitizeHeaders } from '../../security/sanitize.js';

describe('sanitizePayload', () => {
  it('strips PII fields from Stripe payload', () => {
    const payload = {
      id: 'evt_123',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_123',
          customer_email: 'user@example.com',
          customer_name: 'John Doe',
          receipt_email: 'receipt@example.com',
          billing_details: { address: { city: 'SF' } },
          shipping: { name: 'John', address: {} },
          status: 'active',
        },
      },
    };

    const sanitized = sanitizePayload('stripe', payload);
    const obj = (sanitized.data as any).object;

    expect(obj.customer_email).toBe('[REDACTED]');
    expect(obj.customer_name).toBe('[REDACTED]');
    expect(obj.receipt_email).toBe('[REDACTED]');
    expect(obj.billing_details).toBe('[REDACTED]');
    expect(obj.shipping).toBe('[REDACTED]');
    expect(obj.status).toBe('active');
    expect(obj.id).toBe('sub_123');
  });

  it('strips PII from nested customer object', () => {
    const payload = {
      data: {
        object: {
          customer: {
            id: 'cus_123',
            email: 'user@example.com',
            name: 'John Doe',
            phone: '+1234567890',
            address: { city: 'SF' },
          },
        },
      },
    };

    const sanitized = sanitizePayload('stripe', payload);
    const customer = (sanitized.data as any).object.customer;

    expect(customer.email).toBe('[REDACTED]');
    expect(customer.name).toBe('[REDACTED]');
    expect(customer.phone).toBe('[REDACTED]');
    expect(customer.address).toBe('[REDACTED]');
    expect(customer.id).toBe('cus_123');
  });

  it('does not mutate the original payload', () => {
    const payload = {
      data: {
        object: {
          customer_email: 'user@example.com',
          status: 'active',
        },
      },
    };

    sanitizePayload('stripe', payload);

    expect((payload.data.object as any).customer_email).toBe('user@example.com');
  });

  it('passes through non-Stripe payloads unchanged', () => {
    const payload = {
      data: {
        object: {
          customer_email: 'user@example.com',
        },
      },
    };

    const result = sanitizePayload('apple', payload);
    expect(result).toBe(payload); // same reference — no clone needed
  });

  it('handles payload without data.object gracefully', () => {
    const payload = { id: 'evt_123', type: 'test' };
    const result = sanitizePayload('stripe', payload);
    expect(result).toEqual({ id: 'evt_123', type: 'test' });
  });
});

describe('sanitizeHeaders', () => {
  it('keeps only allowed headers', () => {
    const headers = {
      'stripe-signature': 't=123,v1=abc',
      'content-type': 'application/json',
      'content-length': '512',
      'user-agent': 'Stripe/1.0',
      'authorization': 'Bearer sk_test_xxx',
      'cookie': 'session=abc',
      'x-forwarded-for': '1.2.3.4',
      'host': 'api.example.com',
    };

    const sanitized = sanitizeHeaders(headers);

    expect(sanitized['stripe-signature']).toBe('t=123,v1=abc');
    expect(sanitized['content-type']).toBe('application/json');
    expect(sanitized['content-length']).toBe('512');
    expect(sanitized['user-agent']).toBe('Stripe/1.0');
    expect(sanitized['authorization']).toBeUndefined();
    expect(sanitized['cookie']).toBeUndefined();
    expect(sanitized['x-forwarded-for']).toBeUndefined();
    expect(sanitized['host']).toBeUndefined();
  });

  it('handles empty headers', () => {
    const result = sanitizeHeaders({});
    expect(result).toEqual({});
  });

  it('is case-insensitive for header names', () => {
    const headers = {
      'Content-Type': 'application/json',
      'STRIPE-SIGNATURE': 't=123',
    };

    const sanitized = sanitizeHeaders(headers);
    expect(sanitized['Content-Type']).toBe('application/json');
    expect(sanitized['STRIPE-SIGNATURE']).toBe('t=123');
  });
});
