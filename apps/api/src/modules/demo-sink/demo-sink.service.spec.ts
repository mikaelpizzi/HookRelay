import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { HmacSignerService } from '../dispatcher/hmac-signer.service';
import { DemoSinkService } from './demo-sink.service';

describe('DemoSinkService', () => {
  let service: DemoSinkService;
  let hmacSigner: HmacSignerService;
  const testSecret = 'whsec_demo_test_secret_1234567890';

  beforeEach(() => {
    hmacSigner = new HmacSignerService();
    service = new DemoSinkService(hmacSigner);
    service.setSlowDelayMs(5); // Fast delay for testing SLOW mode
  });

  describe('Mode Management', () => {
    it('initializes in HEALTHY mode by default', () => {
      expect(service.getMode()).toEqual({ mode: 'HEALTHY' });
    });

    it('switches between HEALTHY, DOWN, and SLOW modes', () => {
      expect(service.setMode('DOWN')).toEqual({ mode: 'DOWN' });
      expect(service.getMode()).toEqual({ mode: 'DOWN' });

      expect(service.setMode('SLOW')).toEqual({ mode: 'SLOW' });
      expect(service.getMode()).toEqual({ mode: 'SLOW' });

      expect(service.setMode('HEALTHY')).toEqual({ mode: 'HEALTHY' });
      expect(service.getMode()).toEqual({ mode: 'HEALTHY' });
    });

    it('normalizes lowercase mode strings', () => {
      expect(service.setMode('down' as any)).toEqual({ mode: 'DOWN' });
      expect(service.setMode('slow' as any)).toEqual({ mode: 'SLOW' });
      expect(service.setMode('healthy' as any)).toEqual({ mode: 'HEALTHY' });
    });

    it('throws BadRequestException for invalid modes', () => {
      expect(() => service.setMode('INVALID' as any)).toThrow(
        BadRequestException,
      );
      expect(() => service.setMode('' as any)).toThrow(BadRequestException);
      expect(() => service.setMode(null as any)).toThrow(BadRequestException);
    });
  });

  describe('Webhook Processing - HEALTHY Mode', () => {
    it('processes webhook and logs entry in buffer with 200 OK return', async () => {
      const payload = { event: 'invoice.created', amount: 9900 };
      const rawBody = JSON.stringify(payload);
      const signature = hmacSigner.signPayload(rawBody, testSecret);

      const result = await service.processWebhook(
        { 'x-hookrelay-signature': signature },
        payload,
        rawBody,
        testSecret,
      );

      expect(result).toEqual({
        received: true,
        signatureValid: true,
      });

      const logs = service.getLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].modeAtReceipt).toBe('HEALTHY');
      expect(logs[0].signatureValid).toBe(true);
      expect(logs[0].body).toEqual(payload);
      expect(logs[0].id).toBeDefined();
      expect(logs[0].receivedAt).toBeInstanceOf(Date);
    });

    it('flags invalid signature when payload was tampered', async () => {
      const payload = { event: 'invoice.created', amount: 9900 };
      const rawBody = JSON.stringify(payload);
      const signature = hmacSigner.signPayload(rawBody, testSecret);

      const result = await service.processWebhook(
        { 'x-hookrelay-signature': signature },
        { ...payload, amount: 9999 },
        JSON.stringify({ ...payload, amount: 9999 }),
        testSecret,
      );

      expect(result).toEqual({
        received: true,
        signatureValid: false,
      });

      const logs = service.getLogs();
      expect(logs[0].signatureValid).toBe(false);
    });

    it('flags invalid signature when secret is configured but header is missing', async () => {
      const payload = { event: 'ping' };
      const result = await service.processWebhook(
        {},
        payload,
        JSON.stringify(payload),
        testSecret,
      );

      expect(result).toEqual({
        received: true,
        signatureValid: false,
      });
      expect(service.getLogs()[0].signatureValid).toBe(false);
    });

    it('returns null signatureValid when neither secret nor signature header is present', async () => {
      const payload = { event: 'ping' };
      const result = await service.processWebhook(
        {},
        payload,
        JSON.stringify(payload),
      );

      expect(result).toEqual({
        received: true,
        signatureValid: null,
      });
      expect(service.getLogs()[0].signatureValid).toBeNull();
    });

    it('supports alternative signature header names like x-webhook-signature', async () => {
      const payload = { event: 'charge.succeeded' };
      const rawBody = JSON.stringify(payload);
      const sig = hmacSigner.signPayload(rawBody, testSecret);

      const result = await service.processWebhook(
        { 'x-webhook-signature': sig },
        payload,
        rawBody,
        testSecret,
      );

      expect(result.signatureValid).toBe(true);
    });

    it('uses default signing secret when configured', async () => {
      service.setDefaultSigningSecret(testSecret);
      const payload = { event: 'order.placed' };
      const rawBody = JSON.stringify(payload);
      const sig = hmacSigner.signPayload(rawBody, testSecret);

      const result = await service.processWebhook(
        { 'x-hookrelay-signature': sig },
        payload,
        rawBody,
      );

      expect(result.signatureValid).toBe(true);
    });
  });

  describe('Webhook Processing - DOWN Mode', () => {
    beforeEach(() => {
      service.setMode('DOWN');
    });

    it('records attempt in buffer and throws 503 Service Unavailable', async () => {
      const payload = { event: 'user.registered' };
      const rawBody = JSON.stringify(payload);
      const sig = hmacSigner.signPayload(rawBody, testSecret);

      await expect(
        service.processWebhook(
          { 'x-hookrelay-signature': sig },
          payload,
          rawBody,
          testSecret,
        ),
      ).rejects.toThrow(HttpException);

      try {
        await service.processWebhook(
          { 'x-hookrelay-signature': sig },
          payload,
          rawBody,
          testSecret,
        );
      } catch (err: any) {
        expect(err.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
        expect(err.message).toContain('Service Unavailable (simulated)');
      }

      // Check that attempts were recorded in buffer despite throwing
      const logs = service.getLogs();
      expect(logs.length).toBeGreaterThanOrEqual(1);
      expect(logs[0].modeAtReceipt).toBe('DOWN');
      expect(logs[0].signatureValid).toBe(true);
    });
  });

  describe('Webhook Processing - SLOW Mode', () => {
    beforeEach(() => {
      service.setMode('SLOW');
      service.setSlowDelayMs(10);
    });

    it('executes simulated delay, records in buffer, and returns 200 OK with delay info', async () => {
      const payload = { event: 'heavy.computation' };
      const rawBody = JSON.stringify(payload);

      const startTime = Date.now();
      const result = await service.processWebhook(
        {},
        payload,
        rawBody,
      );
      const elapsed = Date.now() - startTime;

      expect(elapsed).toBeGreaterThanOrEqual(9);
      expect(result).toEqual({
        received: true,
        signatureValid: null,
        simulatedDelayMs: 10,
      });

      const logs = service.getLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].modeAtReceipt).toBe('SLOW');
      expect(logs[0].simulatedDelayMs).toBe(10);
    });
  });

  describe('Circular Buffer & Logs Management', () => {
    it('caps in-memory buffer at exactly 50 items and orders newest first', async () => {
      for (let i = 1; i <= 55; i++) {
        await service.processWebhook({}, { seq: i }, JSON.stringify({ seq: i }));
      }

      const logs = service.getLogs();
      expect(logs).toHaveLength(50);
      // Newest should be seq: 55, oldest kept should be seq: 6 (1 to 5 evicted)
      expect(logs[0].body).toEqual({ seq: 55 });
      expect(logs[49].body).toEqual({ seq: 6 });
    });

    it('clears logs and resets buffer to empty', async () => {
      await service.processWebhook({}, { id: 1 }, JSON.stringify({ id: 1 }));
      await service.processWebhook({}, { id: 2 }, JSON.stringify({ id: 2 }));

      expect(service.getLogs()).toHaveLength(2);

      const clearResult = service.clearLogs();
      expect(clearResult).toEqual({ cleared: true, count: 2 });
      expect(service.getLogs()).toEqual([]);
    });
  });
});
