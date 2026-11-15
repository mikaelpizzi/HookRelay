import * as crypto from 'node:crypto';
import { HmacSignerService } from './hmac-signer.service';

describe('HmacSignerService', () => {
  let service: HmacSignerService;
  const secret = 'whsec_test_secret_key_12345';
  const payload = JSON.stringify({ event: 'order.created', id: 'ord_123' });

  beforeEach(() => {
    service = new HmacSignerService();
  });

  describe('signPayload', () => {
    it('signs payload correctly in t=...,v1=... format with default timestamp', () => {
      const header = service.signPayload(payload, secret);
      expect(header).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);

      const timestamp = service.extractTimestamp(header);
      expect(timestamp).toBeDefined();
      const now = Math.floor(Date.now() / 1000);
      expect(Math.abs(now - (timestamp ?? 0))).toBeLessThanOrEqual(2);
    });

    it('signs payload with explicit timestamp', () => {
      const fixedTimestamp = 1700000000;
      const header = service.signPayload(payload, secret, fixedTimestamp);

      const expectedSig = crypto
        .createHmac('sha256', secret)
        .update(`${fixedTimestamp}.${payload}`)
        .digest('hex');

      expect(header).toBe(`t=${fixedTimestamp},v1=${expectedSig}`);
    });
  });

  describe('verifySignature', () => {
    it('verifies valid signature within tolerance window', () => {
      const now = Math.floor(Date.now() / 1000);
      const header = service.signPayload(payload, secret, now);

      const isValid = service.verifySignature(payload, header, secret);
      expect(isValid).toBe(true);
    });

    it('verifies signature when timestamp is slightly in the past within tolerance', () => {
      const now = Math.floor(Date.now() / 1000);
      const pastTimestamp = now - 120; // 2 minutes ago
      const header = service.signPayload(payload, secret, pastTimestamp);

      const isValid = service.verifySignature(payload, header, secret, 300);
      expect(isValid).toBe(true);
    });

    it('verifies signature when timestamp is slightly in the future within clock skew', () => {
      const now = Math.floor(Date.now() / 1000);
      const futureTimestamp = now + 60; // 1 minute in future
      const header = service.signPayload(payload, secret, futureTimestamp);

      const isValid = service.verifySignature(payload, header, secret, 300);
      expect(isValid).toBe(true);
    });

    it('rejects tampered body', () => {
      const now = Math.floor(Date.now() / 1000);
      const header = service.signPayload(payload, secret, now);
      const tamperedBody = JSON.stringify({
        event: 'order.created',
        id: 'ord_999',
      });

      const isValid = service.verifySignature(tamperedBody, header, secret);
      expect(isValid).toBe(false);
    });

    it('rejects expired timestamp (> toleranceSec in past)', () => {
      const now = Math.floor(Date.now() / 1000);
      const expiredTimestamp = now - 301;
      const header = service.signPayload(payload, secret, expiredTimestamp);

      const isValid = service.verifySignature(payload, header, secret, 300);
      expect(isValid).toBe(false);
    });

    it('rejects future timestamp beyond skew window', () => {
      const now = Math.floor(Date.now() / 1000);
      const futureTimestamp = now + 301;
      const header = service.signPayload(payload, secret, futureTimestamp);

      const isValid = service.verifySignature(payload, header, secret, 300);
      expect(isValid).toBe(false);
    });

    it('rejects signature generated with wrong secret', () => {
      const now = Math.floor(Date.now() / 1000);
      const header = service.signPayload(payload, 'wrong_secret', now);

      const isValid = service.verifySignature(payload, header, secret);
      expect(isValid).toBe(false);
    });

    it('supports multiple v1 signatures for secret rotation', () => {
      const now = Math.floor(Date.now() / 1000);
      const oldSecret = 'whsec_old_secret';
      const newSecret = secret;

      const oldSig = crypto
        .createHmac('sha256', oldSecret)
        .update(`${now}.${payload}`)
        .digest('hex');
      const newSig = crypto
        .createHmac('sha256', newSecret)
        .update(`${now}.${payload}`)
        .digest('hex');

      const dualHeader = `t=${now},v1=${oldSig},v1=${newSig}`;

      expect(service.verifySignature(payload, dualHeader, oldSecret)).toBe(
        true,
      );
      expect(service.verifySignature(payload, dualHeader, newSecret)).toBe(
        true,
      );
      expect(service.verifySignature(payload, dualHeader, 'unknown')).toBe(
        false,
      );
    });

    it('handles malformed signature length or non-hex safely without throwing RangeError', () => {
      const now = Math.floor(Date.now() / 1000);
      expect(
        service.verifySignature(payload, `t=${now},v1=short`, secret),
      ).toBe(false);
      expect(
        service.verifySignature(payload, `t=${now},v1=`, secret),
      ).toBe(false);
      expect(
        service.verifySignature(
          payload,
          `t=${now},v1=${'z'.repeat(64)}`,
          secret,
        ),
      ).toBe(false);
      expect(
        service.verifySignature(
          payload,
          `t=${now},v1=${'a'.repeat(63)}`,
          secret,
        ),
      ).toBe(false);
      expect(
        service.verifySignature(
          payload,
          `t=${now},v1=${'a'.repeat(65)}`,
          secret,
        ),
      ).toBe(false);
    });

    it('rejects invalid or missing inputs cleanly', () => {
      expect(service.verifySignature('', '', '')).toBe(false);
      expect(service.verifySignature(payload, '', secret)).toBe(false);
      expect(service.verifySignature(payload, 'invalid_header', secret)).toBe(
        false,
      );
      expect(
        service.verifySignature(payload, 'v1=abc123', secret),
      ).toBe(false);
      expect(
        service.verifySignature(payload, 't=notanumber,v1=abc', secret),
      ).toBe(false);
    });
  });

  describe('extractTimestamp', () => {
    it('extracts valid timestamp from header', () => {
      const header = 't=1700000000,v1=abc';
      expect(service.extractTimestamp(header)).toBe(1700000000);
    });

    it('handles whitespace around comma and equals', () => {
      const header = ' t = 1700000000 , v1 = abc ';
      // ' t ' trimmed becomes 't'
      expect(service.extractTimestamp(header)).toBe(1700000000);
    });

    it('returns null when header is invalid or missing timestamp', () => {
      expect(service.extractTimestamp('')).toBeNull();
      expect(service.extractTimestamp('v1=abcdef')).toBeNull();
      expect(service.extractTimestamp('t=invalid')).toBeNull();
    });
  });
});
