import * as dns from 'node:dns';
import { errors, MockAgent } from 'undici';
import { SsrfValidatorService } from '../endpoints/ssrf-validator.service';
import { HmacSignerService } from './hmac-signer.service';
import {
  SafeHttpTransport,
  WebhookDispatchOptions,
} from './safe-http-transport.service';

describe('SafeHttpTransport', () => {
  let transport: SafeHttpTransport;
  let ssrfValidator: SsrfValidatorService;
  let hmacSigner: HmacSignerService;
  let mockAgent: MockAgent;

  const defaultOptions: WebhookDispatchOptions = {
    url: 'http://example.com/webhook',
    payload: JSON.stringify({ event: 'invoice.paid', amount: 5000 }),
    secret: 'whsec_secret_123',
    deliveryId: 'del_12345678-1234-1234-1234-123456789abc',
    eventId: 'evt_87654321-4321-4321-4321-cba987654321',
    correlationId: 'corr_test_001',
    extraHeaders: {
      'X-Custom-Header': 'CustomValue',
    },
  };

  beforeEach(() => {
    ssrfValidator = new SsrfValidatorService();
    hmacSigner = new HmacSignerService();
    transport = new SafeHttpTransport(ssrfValidator, hmacSigner);

    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    transport.setDispatcher(mockAgent);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await mockAgent.close();
  });

  describe('dispatchWebhook', () => {
    it('dispatches POST request with correct headers, signature, and body', async () => {
      let capturedHeaders: Record<string, any> = {};
      let capturedBody = '';

      const client = mockAgent.get('http://example.com');
      client
        .intercept({
          path: '/webhook',
          method: 'POST',
        })
        .reply(200, (opts) => {
          capturedHeaders = opts.headers as Record<string, any>;
          capturedBody = opts.body as string;
          return { received: true };
        });

      const result = await transport.dispatchWebhook(defaultOptions);

      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(JSON.parse(result.responseBody!)).toEqual({ received: true });

      expect(capturedBody).toBe(defaultOptions.payload);
      const getHeader = (name: string) => {
        const key = Object.keys(capturedHeaders).find(
          (k) => k.toLowerCase() === name.toLowerCase(),
        );
        return key ? capturedHeaders[key] : undefined;
      };

      expect(getHeader('User-Agent')).toBe('HookRelay-Dispatcher/1.0');
      expect(getHeader('Content-Type')).toBe('application/json');
      expect(getHeader('X-HookRelay-Delivery-Id')).toBe(
        defaultOptions.deliveryId,
      );
      expect(getHeader('X-HookRelay-Event-Id')).toBe(
        defaultOptions.eventId,
      );
      expect(getHeader('X-Correlation-Id')).toBe(
        defaultOptions.correlationId,
      );
      expect(getHeader('X-Custom-Header')).toBe('CustomValue');

      // Signature header must be valid according to HmacSignerService
      const signatureHeader = getHeader('X-HookRelay-Signature');
      expect(signatureHeader).toBeDefined();
      expect(
        hmacSigner.verifySignature(
          defaultOptions.payload,
          signatureHeader,
          defaultOptions.secret,
        ),
      ).toBe(true);
    });

    it('successfully handles 2xx response', async () => {
      const client = mockAgent.get('http://example.com');
      client
        .intercept({
          path: '/webhook',
          method: 'POST',
        })
        .reply(204, '');

      const result = await transport.dispatchWebhook(defaultOptions);

      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(204);
      expect(result.responseBody).toBe('');
      expect(result.errorCode).toBeUndefined();
    });

    it('handles 4xx responses as non-success with status code and body', async () => {
      const client = mockAgent.get('http://example.com');
      client
        .intercept({
          path: '/webhook',
          method: 'POST',
        })
        .reply(400, JSON.stringify({ error: 'Bad Request' }));

      const result = await transport.dispatchWebhook(defaultOptions);

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(400);
      expect(result.responseBody).toContain('Bad Request');
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('handles 5xx responses as non-success with status code and body', async () => {
      const client = mockAgent.get('http://example.com');
      client
        .intercept({
          path: '/webhook',
          method: 'POST',
        })
        .reply(503, 'Service Unavailable');

      const result = await transport.dispatchWebhook(defaultOptions);

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(503);
      expect(result.responseBody).toBe('Service Unavailable');
    });

    it('handles network timeout gracefully with TIMED_OUT error code', async () => {
      const client = mockAgent.get('http://example.com');
      client
        .intercept({
          path: '/webhook',
          method: 'POST',
        })
        .replyWithError(new errors.ConnectTimeoutError('Connect Timeout Error'));

      const result = await transport.dispatchWebhook(defaultOptions);

      expect(result.success).toBe(false);
      expect(result.statusCode).toBeUndefined();
      expect(result.errorCode).toBe('TIMED_OUT');
      expect(result.errorMessage).toContain('Connect Timeout Error');
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('handles headers timeout gracefully with TIMED_OUT error code', async () => {
      const client = mockAgent.get('http://example.com');
      client
        .intercept({
          path: '/webhook',
          method: 'POST',
        })
        .replyWithError(new errors.HeadersTimeoutError('Headers Timeout Error'));

      const result = await transport.dispatchWebhook(defaultOptions);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('TIMED_OUT');
    });

    it('handles body timeout gracefully with TIMED_OUT error code', async () => {
      const client = mockAgent.get('http://example.com');
      client
        .intercept({
          path: '/webhook',
          method: 'POST',
        })
        .replyWithError(new errors.BodyTimeoutError('Body Timeout Error'));

      const result = await transport.dispatchWebhook(defaultOptions);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('TIMED_OUT');
    });

    it('handles connection refused gracefully with CONNECTION_REFUSED', async () => {
      const client = mockAgent.get('http://example.com');
      const connErr = Object.assign(new Error('connect ECONNREFUSED 1.2.3.4'), {
        code: 'ECONNREFUSED',
      });
      client
        .intercept({
          path: '/webhook',
          method: 'POST',
        })
        .replyWithError(connErr);

      const result = await transport.dispatchWebhook(defaultOptions);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('CONNECTION_REFUSED');
    });

    it('handles DNS lookup failures gracefully with DNS_LOOKUP_FAILED', async () => {
      const client = mockAgent.get('http://example.com');
      const dnsErr = Object.assign(
        new Error('getaddrinfo ENOTFOUND example.com'),
        {
          code: 'ENOTFOUND',
        },
      );
      client
        .intercept({
          path: '/webhook',
          method: 'POST',
        })
        .replyWithError(dnsErr);

      const result = await transport.dispatchWebhook(defaultOptions);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('DNS_LOOKUP_FAILED');
    });

    it('blocks private IPv4 targets immediately with SSRF_BLOCKED', async () => {
      const privateTargets = [
        'http://127.0.0.1:8080/hook',
        'http://10.0.0.1/hook',
        'http://172.16.0.1/hook',
        'http://192.168.1.1/hook',
        'http://169.254.169.254/latest/meta-data',
        'http://0.0.0.0:8000/hook',
      ];

      for (const target of privateTargets) {
        const result = await transport.dispatchWebhook({
          ...defaultOptions,
          url: target,
        });

        expect(result.success).toBe(false);
        expect(result.errorCode).toBe('SSRF_BLOCKED');
        expect(result.errorMessage).toContain('SSRF_BLOCKED');
      }
    });

    it('blocks localhost target hostname immediately with SSRF_BLOCKED', async () => {
      const result = await transport.dispatchWebhook({
        ...defaultOptions,
        url: 'http://localhost:8080/webhook',
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('SSRF_BLOCKED');
      expect(result.errorMessage).toContain('localhost');
    });

    it('blocks subdomains of localhost with SSRF_BLOCKED', async () => {
      const result = await transport.dispatchWebhook({
        ...defaultOptions,
        url: 'http://service.localhost:3000/webhook',
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('SSRF_BLOCKED');
    });

    it('blocks private IPv6 targets immediately with SSRF_BLOCKED', async () => {
      const result = await transport.dispatchWebhook({
        ...defaultOptions,
        url: 'http://[::1]:8080/webhook',
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('SSRF_BLOCKED');
    });

    it('rejects disallowed protocols like ftp and file with SSRF_BLOCKED', async () => {
      const ftpResult = await transport.dispatchWebhook({
        ...defaultOptions,
        url: 'ftp://example.com/webhook',
      });
      expect(ftpResult.success).toBe(false);
      expect(ftpResult.errorCode).toBe('SSRF_BLOCKED');

      const fileResult = await transport.dispatchWebhook({
        ...defaultOptions,
        url: 'file:///etc/passwd',
      });
      expect(fileResult.success).toBe(false);
      expect(fileResult.errorCode).toBe('SSRF_BLOCKED');
    });

    it('rejects malformed URLs with INVALID_URL', async () => {
      const result = await transport.dispatchWebhook({
        ...defaultOptions,
        url: 'not-a-valid-url',
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_URL');
    });

    it('truncates oversized response bodies safely to 64 KB', async () => {
      const largeBody = 'A'.repeat(100 * 1024); // 100 KB
      const client = mockAgent.get('http://example.com');
      client
        .intercept({
          path: '/webhook',
          method: 'POST',
        })
        .reply(200, largeBody);

      const result = await transport.dispatchWebhook(defaultOptions);

      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(result.responseBody).toBeDefined();
      expect(result.responseBody!.length).toBe(64 * 1024); // Exactly 65536 bytes
    });
  });

  describe('customLookup (DNS Pinning against DNS Rebinding)', () => {
    it('blocks resolution to loopback address (127.0.0.1)', (done) => {
      jest
        .spyOn(dns, 'lookup')
        .mockImplementation(((
          _host: string,
          _opts: any,
          cb: (err: any, addr: any) => void,
        ) => {
          cb(null, [{ address: '127.0.0.1', family: 4 }]);
        }) as any);

      transport.customLookup(
        'attacker-rebind.com',
        { all: true },
        (err, _addresses) => {
          expect(err).toBeDefined();
          expect(err?.message).toContain('SSRF_BLOCKED');
          expect((err as any)?.code).toBe('SSRF_BLOCKED');
          done();
        },
      );
    });

    it('blocks resolution to AWS cloud metadata (169.254.169.254)', (done) => {
      jest
        .spyOn(dns, 'lookup')
        .mockImplementation(((
          _host: string,
          _opts: any,
          cb: (err: any, addr: any) => void,
        ) => {
          cb(null, [{ address: '169.254.169.254', family: 4 }]);
        }) as any);

      transport.customLookup(
        'attacker-rebind.com',
        { all: true },
        (err, _addresses) => {
          expect(err).toBeDefined();
          expect(err?.message).toContain('SSRF_BLOCKED');
          expect(err?.message).toContain('169.254.169.254');
          done();
        },
      );
    });

    it('blocks resolution to private RFC 1918 addresses (10.0.0.5)', (done) => {
      jest
        .spyOn(dns, 'lookup')
        .mockImplementation(((
          _host: string,
          _opts: any,
          cb: (err: any, addr: any) => void,
        ) => {
          cb(null, [{ address: '10.0.0.5', family: 4 }]);
        }) as any);

      transport.customLookup(
        'internal-corp.attacker.com',
        { all: true },
        (err) => {
          expect(err).toBeDefined();
          expect(err?.message).toContain('SSRF_BLOCKED');
          done();
        },
      );
    });

    it('blocks resolution when one of multiple IPs is in forbidden range', (done) => {
      jest
        .spyOn(dns, 'lookup')
        .mockImplementation(((
          _host: string,
          _opts: any,
          cb: (err: any, addr: any) => void,
        ) => {
          cb(null, [
            { address: '93.184.216.34', family: 4 }, // public
            { address: '127.0.0.1', family: 4 }, // loopback
          ]);
        }) as any);

      transport.customLookup(
        'dual-homed-evil.com',
        { all: true },
        (err) => {
          expect(err).toBeDefined();
          expect(err?.message).toContain('SSRF_BLOCKED');
          done();
        },
      );
    });

    it('blocks resolution when all: false and IP is forbidden', (done) => {
      jest
        .spyOn(dns, 'lookup')
        .mockImplementation(((
          _host: string,
          _opts: any,
          cb: (err: any, addr: any, fam: any) => void,
        ) => {
          cb(null, '192.168.0.1', 4);
        }) as any);

      transport.customLookup('router.local', {}, (err) => {
        expect(err).toBeDefined();
        expect(err?.message).toContain('SSRF_BLOCKED');
        done();
      });
    });

    it('allows resolution to legitimate public IP addresses', (done) => {
      const publicAddresses = [{ address: '93.184.216.34', family: 4 }];
      jest
        .spyOn(dns, 'lookup')
        .mockImplementation(((
          _host: string,
          _opts: any,
          cb: (err: any, addr: any) => void,
        ) => {
          cb(null, publicAddresses);
        }) as any);

      transport.customLookup(
        'example.com',
        { all: true },
        (err, addresses) => {
          expect(err).toBeNull();
          expect(addresses).toEqual(publicAddresses);
          done();
        },
      );
    });

    it('immediately blocks localhost without performing DNS lookup', (done) => {
      const lookupSpy = jest.spyOn(dns, 'lookup');

      transport.customLookup('localhost', { all: true }, (err) => {
        expect(err).toBeDefined();
        expect(err?.message).toContain('localhost');
        expect(lookupSpy).not.toHaveBeenCalled();
        done();
      });
    });

    it('forwards DNS lookup errors directly', (done) => {
      const dnsErr = Object.assign(new Error('getaddrinfo ENOTFOUND'), {
        code: 'ENOTFOUND',
      });
      jest
        .spyOn(dns, 'lookup')
        .mockImplementation(((
          _host: string,
          _opts: any,
          cb: (err: any) => void,
        ) => {
          cb(dnsErr);
        }) as any);

      transport.customLookup('nonexistent.example', {}, (err) => {
        expect(err).toBe(dnsErr);
        done();
      });
    });
  });

  describe('onModuleDestroy', () => {
    it('destroys dispatcher cleanly', async () => {
      const realTransport = new SafeHttpTransport(ssrfValidator, hmacSigner);
      const destroySpy = jest.spyOn(realTransport.getDispatcher(), 'destroy');
      await realTransport.onModuleDestroy();
      expect(destroySpy).toHaveBeenCalled();
      await realTransport.onModuleDestroy();
    });
  });

  describe('Local Demo Sink dispatch allowance', () => {
    it('allows dispatching to localhost demo sink when intercepting via dispatcher', async () => {
      const client = mockAgent.get('http://localhost:3000');
      client
        .intercept({
          path: '/api/demo/webhook-sink',
          method: 'POST',
        })
        .reply(200, { received: true });

      const result = await transport.dispatchWebhook({
        ...defaultOptions,
        url: 'http://localhost:3000/api/demo/webhook-sink',
      });

      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);
    });

    it('allows dispatching to 127.0.0.1 demo sink v1 path', async () => {
      const client = mockAgent.get('http://127.0.0.1:3000');
      client
        .intercept({
          path: '/api/v1/demo/webhook-sink',
          method: 'POST',
        })
        .reply(200, { received: true });

      const result = await transport.dispatchWebhook({
        ...defaultOptions,
        url: 'http://127.0.0.1:3000/api/v1/demo/webhook-sink',
      });

      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);
    });
  });
});
