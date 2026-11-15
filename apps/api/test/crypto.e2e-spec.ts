import * as crypto from 'node:crypto';
import { HmacSignerService } from '../src/modules/dispatcher/hmac-signer.service';

describe('Crypto HMAC & Signature Verification (E2E / Integration)', () => {
  let signer: HmacSignerService;
  const testSecret = 'whsec_9f8e7d6c5b4a3210fedcba9876543210';
  const knownPayload = JSON.stringify({
    event: 'order.completed',
    orderId: 'ord_1234567890',
    amount: 199.99,
    currency: 'USD',
  });

  beforeAll(() => {
    signer = new HmacSignerService();
  });

  describe('HMAC-SHA256 generation on known payload and digest validation', () => {
    it('should generate signature adhering to standard t={timestamp},v1={digest} format', () => {
      const fixedTimestamp = 1700000000;
      const expectedDigest = crypto
        .createHmac('sha256', testSecret)
        .update(`${fixedTimestamp}.${knownPayload}`)
        .digest('hex');

      const header = signer.signPayload(knownPayload, testSecret, fixedTimestamp);

      expect(header).toBe(`t=${fixedTimestamp},v1=${expectedDigest}`);
      expect(header).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    });

    it('should use current unix epoch timestamp when timestamp parameter is omitted', () => {
      const before = Math.floor(Date.now() / 1000);
      const header = signer.signPayload(knownPayload, testSecret);
      const after = Math.floor(Date.now() / 1000);

      const parsed = signer.parseHeader(header);
      expect(parsed.timestamp).toBeGreaterThanOrEqual(before);
      expect(parsed.timestamp).toBeLessThanOrEqual(after);
      expect(parsed.signatures.length).toBe(1);
    });

    it('should successfully verify a freshly generated signature', () => {
      const header = signer.signPayload(knownPayload, testSecret);
      const isValid = signer.verifySignature(knownPayload, header, testSecret);
      expect(isValid).toBe(true);
    });
  });

  describe('timingSafeEqual constant-time comparison safety', () => {
    it('should invoke crypto.timingSafeEqual and accept authentic signatures', () => {
      const timingSafeEqualSpy = jest.spyOn(crypto, 'timingSafeEqual');
      const header = signer.signPayload(knownPayload, testSecret);

      const isValid = signer.verifySignature(knownPayload, header, testSecret);

      expect(isValid).toBe(true);
      expect(timingSafeEqualSpy).toHaveBeenCalled();
      timingSafeEqualSpy.mockRestore();
    });

    it('should safely reject signatures of unequal buffer length without throwing RangeError', () => {
      const fixedTimestamp = Math.floor(Date.now() / 1000);
      const truncatedHeader = `t=${fixedTimestamp},v1=abcd`;

      expect(() => {
        const isValid = signer.verifySignature(knownPayload, truncatedHeader, testSecret);
        expect(isValid).toBe(false);
      }).not.toThrow();
    });

    it('should reject signatures with invalid non-hex characters gracefully', () => {
      const fixedTimestamp = Math.floor(Date.now() / 1000);
      const invalidHexSig = 'z'.repeat(64);
      const malformedHeader = `t=${fixedTimestamp},v1=${invalidHexSig}`;

      const isValid = signer.verifySignature(knownPayload, malformedHeader, testSecret);
      expect(isValid).toBe(false);
    });
  });

  describe('Payload tampering protection', () => {
    it('should reject signature when exactly 1 byte in the payload is altered', () => {
      const header = signer.signPayload(knownPayload, testSecret);

      // Mutate 1 character in payload body
      const tamperedPayload = knownPayload.replace('199.99', '199.98');
      expect(tamperedPayload).not.toBe(knownPayload);

      const isValid = signer.verifySignature(tamperedPayload, header, testSecret);
      expect(isValid).toBe(false);
    });

    it('should reject signature when trailing whitespace or newline is appended to payload', () => {
      const header = signer.signPayload(knownPayload, testSecret);
      const tamperedPayload = `${knownPayload}\n`;

      const isValid = signer.verifySignature(tamperedPayload, header, testSecret);
      expect(isValid).toBe(false);
    });
  });

  describe('Anti-replay tolerance window (t= validation)', () => {
    it('should reject signatures with timestamp older than 300 seconds by default', () => {
      const staleTimestamp = Math.floor(Date.now() / 1000) - 301;
      const staleHeader = signer.signPayload(knownPayload, testSecret, staleTimestamp);

      const isValid = signer.verifySignature(knownPayload, staleHeader, testSecret);
      expect(isValid).toBe(false);
    });

    it('should reject signatures with future timestamp exceeding 300 seconds tolerance', () => {
      const futureTimestamp = Math.floor(Date.now() / 1000) + 305;
      const futureHeader = signer.signPayload(knownPayload, testSecret, futureTimestamp);

      const isValid = signer.verifySignature(knownPayload, futureHeader, testSecret);
      expect(isValid).toBe(false);
    });

    it('should accept signature when within custom tolerance window', () => {
      const pastTimestamp = Math.floor(Date.now() / 1000) - 450;
      const header = signer.signPayload(knownPayload, testSecret, pastTimestamp);

      // Fails with default 300s window
      expect(signer.verifySignature(knownPayload, header, testSecret, 300)).toBe(false);
      // Passes with expanded 600s window
      expect(signer.verifySignature(knownPayload, header, testSecret, 600)).toBe(true);
    });

    it('should reject signature headers missing timestamp key', () => {
      const headerWithoutTs = `v1=${'a'.repeat(64)}`;
      const isValid = signer.verifySignature(knownPayload, headerWithoutTs, testSecret);
      expect(isValid).toBe(false);
    });
  });

  describe('Secret rotation & multi-v1 headers', () => {
    const oldSecret = 'whsec_old_secret_0123456789abcdef0123456789abcdef';
    const newSecret = 'whsec_new_secret_fedcba9876543210fedcba9876543210';
    const invalidSecret = 'whsec_unrelated_secret_000000000000000000000000';

    it('should accept header containing multiple v1 signatures when verified against old or new secret', () => {
      const now = Math.floor(Date.now() / 1000);
      const oldDigest = crypto
        .createHmac('sha256', oldSecret)
        .update(`${now}.${knownPayload}`)
        .digest('hex');
      const newDigest = crypto
        .createHmac('sha256', newSecret)
        .update(`${now}.${knownPayload}`)
        .digest('hex');

      // Combined dual-signature header during active secret rollover
      const dualHeader = `t=${now},v1=${oldDigest},v1=${newDigest}`;

      expect(signer.verifySignature(knownPayload, dualHeader, oldSecret)).toBe(true);
      expect(signer.verifySignature(knownPayload, dualHeader, newSecret)).toBe(true);
      expect(signer.verifySignature(knownPayload, dualHeader, invalidSecret)).toBe(false);
    });

    it('should correctly parse all signatures into ParsedSignatureHeader array', () => {
      const now = 1700000000;
      const header = `t=${now}, v1=sig_alpha, v1=sig_beta, v1=sig_gamma`;

      const parsed = signer.parseHeader(header);
      expect(parsed.timestamp).toBe(now);
      expect(parsed.signatures).toEqual(['sig_alpha', 'sig_beta', 'sig_gamma']);
      expect(signer.extractTimestamp(header)).toBe(now);
    });
  });
});
