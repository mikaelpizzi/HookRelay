import * as net from 'node:net';
import { BadRequestException } from '@nestjs/common';
import { SsrfValidatorService } from '../src/modules/endpoints/ssrf-validator.service';
import { SafeHttpTransport } from '../src/modules/dispatcher/safe-http-transport.service';
import { HmacSignerService } from '../src/modules/dispatcher/hmac-signer.service';

describe('SSRF Guard & Safe HTTP Transport (E2E / Integration)', () => {
  let ssrfValidator: SsrfValidatorService;
  let signer: HmacSignerService;
  let transport: SafeHttpTransport;

  beforeAll(() => {
    ssrfValidator = new SsrfValidatorService();
    signer = new HmacSignerService();
    transport = new SafeHttpTransport(ssrfValidator, signer);
  });

  afterAll(async () => {
    await transport.onModuleDestroy();
  });

  describe('SsrfValidatorService address restriction matrix', () => {
    const forbiddenAddresses = [
      { host: '127.0.0.1', desc: 'IPv4 loopback' },
      { host: '10.0.0.5', desc: 'IPv4 Class A private (10.0.0.0/8)' },
      { host: '172.16.0.1', desc: 'IPv4 Class B private (172.16.0.0/12)' },
      { host: '192.168.1.1', desc: 'IPv4 Class C private (192.168.0.0/16)' },
      { host: '169.254.169.254', desc: 'IPv4 Link-local / Cloud metadata' },
      { host: '[::1]', desc: 'IPv6 loopback' },
      { host: '[fe80::1]', desc: 'IPv6 Link-local' },
    ];

    for (const { host, desc } of forbiddenAddresses) {
      it(`should reject forbidden address ${host} (${desc})`, async () => {
        const url = `http://${host}/webhook`;
        await expect(ssrfValidator.validateUrl(url)).rejects.toThrow(
          BadRequestException,
        );

        try {
          await ssrfValidator.validateUrl(url);
        } catch (error: any) {
          expect(error.message).toContain('SSRF_BLOCKED');
        }
      });
    }

    it('should reject localhost hostname', async () => {
      await expect(ssrfValidator.validateUrl('http://localhost:3000/endpoint')).rejects.toThrow(
        /SSRF_BLOCKED.*localhost/,
      );
    });

    it('should reject non-HTTP protocols (e.g. file:, ftp:, gopher:)', async () => {
      await expect(ssrfValidator.validateUrl('file:///etc/passwd')).rejects.toThrow(
        /SSRF_BLOCKED.*Protocol 'file' is not allowed/,
      );
      await expect(ssrfValidator.validateUrl('gopher://127.0.0.1:70/')).rejects.toThrow(
        /SSRF_BLOCKED.*Protocol 'gopher' is not allowed/,
      );
    });
  });

  describe('SafeHttpTransport dispatch blocking & connection abort', () => {
    let mockTcpServer: net.Server;
    let tcpPort: number;
    let tcpConnectionCount = 0;

    beforeAll((done) => {
      mockTcpServer = net.createServer((socket) => {
        tcpConnectionCount++;
        socket.destroy();
      });

      mockTcpServer.listen(0, '127.0.0.1', () => {
        const addr = mockTcpServer.address() as net.AddressInfo;
        tcpPort = addr.port;
        done();
      });
    });

    afterAll((done) => {
      mockTcpServer.close(done);
    });

    beforeEach(() => {
      tcpConnectionCount = 0;
    });

    it('should abort dispatch to 127.0.0.1 BEFORE opening a TCP socket or transmitting payload', async () => {
      const result = await transport.dispatchWebhook({
        url: `http://127.0.0.1:${tcpPort}/webhook-target`,
        payload: JSON.stringify({ sensitive: 'credentials_token_here' }),
        secret: 'whsec_test_secret_123',
        deliveryId: 'del_123',
        eventId: 'evt_123',
        correlationId: 'corr_123',
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('SSRF_BLOCKED');
      expect(result.errorMessage).toContain('SSRF_BLOCKED');

      // Crucial security guarantee: verify TCP connection was never established
      expect(tcpConnectionCount).toBe(0);
    });

    const forbiddenIps = [
      '10.0.0.5',
      '172.16.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '[::1]',
      '[fe80::1]',
    ];

    for (const ip of forbiddenIps) {
      it(`should synchronously abort dispatch to ${ip} with SSRF_BLOCKED error`, async () => {
        const result = await transport.dispatchWebhook({
          url: `http://${ip}/webhook`,
          payload: JSON.stringify({ test: true }),
          secret: 'whsec_test',
          deliveryId: 'del_test',
          eventId: 'evt_test',
          correlationId: 'corr_test',
        });

        expect(result.success).toBe(false);
        expect(result.errorCode).toBe('SSRF_BLOCKED');
      });
    }
  });

  describe('Permitted endpoints & local demo sink exceptions', () => {
    it('should permit legitimate public domains', async () => {
      await expect(
        ssrfValidator.validateUrl('https://example.com/webhooks/incoming'),
      ).resolves.not.toThrow();
    });

    it('should permit allowed local demo sink path under default configuration', async () => {
      const demoSinkUrl = 'http://127.0.0.1:3000/api/v1/demo/webhook-sink';
      const parsed = new URL(demoSinkUrl);

      expect(ssrfValidator.isAllowedLocalUrl(parsed)).toBe(true);
      await expect(ssrfValidator.validateUrl(demoSinkUrl)).resolves.not.toThrow();
    });

    it('should permit arbitrary local URLs when ALLOW_LOCAL_WEBHOOKS=true is configured', () => {
      const prevEnv = process.env.ALLOW_LOCAL_WEBHOOKS;
      try {
        process.env.ALLOW_LOCAL_WEBHOOKS = 'true';
        const arbitraryLocal = new URL('http://127.0.0.1:8080/custom-test');
        expect(ssrfValidator.isAllowedLocalUrl(arbitraryLocal)).toBe(true);
      } finally {
        process.env.ALLOW_LOCAL_WEBHOOKS = prevEnv;
      }
    });
  });
});
