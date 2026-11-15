import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as dns from 'node:dns';
import { SsrfValidatorService } from './ssrf-validator.service';

describe('SsrfValidatorService', () => {
  let service: SsrfValidatorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SsrfValidatorService],
    }).compile();

    service = module.get<SsrfValidatorService>(SsrfValidatorService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('Allowed URLs', () => {
    it('should allow public domains that resolve to public IPs', async () => {
      jest.spyOn(dns.promises, 'lookup').mockResolvedValue([
        { address: '93.184.216.34', family: 4 },
      ] as any);

      await expect(
        service.validateUrl('https://example.com/events'),
      ).resolves.toBeUndefined();
    });

    it('should allow Stripe webhook URLs with public IPs', async () => {
      jest.spyOn(dns.promises, 'lookup').mockResolvedValue([
        { address: '54.187.205.235', family: 4 },
      ] as any);

      await expect(
        service.validateUrl('https://api.stripe.com/webhook'),
      ).resolves.toBeUndefined();
    });

    it('should allow public IPv6 addresses', async () => {
      jest.spyOn(dns.promises, 'lookup').mockResolvedValue([
        { address: '2606:4700:4700::1111', family: 6 },
      ] as any);

      await expect(
        service.validateUrl('https://[2606:4700:4700::1111]/webhook'),
      ).resolves.toBeUndefined();
    });

    it('should allow public IPv4-mapped IPv6 addresses', async () => {
      jest.spyOn(dns.promises, 'lookup').mockResolvedValue([
        { address: '::ffff:8.8.8.8', family: 6 },
      ] as any);

      await expect(
        service.validateUrl('https://[::ffff:8.8.8.8]/webhook'),
      ).resolves.toBeUndefined();
    });
  });

  describe('Blocked Schemes and Invalid URLs', () => {
    it('should reject non-string or empty URLs', async () => {
      await expect(service.validateUrl('')).rejects.toThrow(BadRequestException);
      await expect(service.validateUrl(null as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should reject malformed URLs', async () => {
      await expect(service.validateUrl('invalid-url-string')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should reject FTP scheme', async () => {
      await expect(
        service.validateUrl('ftp://example.com/file'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject file scheme', async () => {
      await expect(service.validateUrl('file:///etc/passwd')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should reject javascript scheme', async () => {
      await expect(service.validateUrl('javascript:alert(1)')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should reject gopher scheme', async () => {
      await expect(
        service.validateUrl('gopher://127.0.0.1:70'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Blocked Hostnames and Explicit Localhost', () => {
    it('should block explicit localhost', async () => {
      await expect(service.validateUrl('http://localhost')).rejects.toThrow(
        /SSRF_BLOCKED.*localhost/,
      );
    });

    it('should block localhost with port', async () => {
      await expect(
        service.validateUrl('http://localhost:8080/hook'),
      ).rejects.toThrow(/SSRF_BLOCKED.*localhost/);
    });

    it('should block subdomains of localhost', async () => {
      await expect(
        service.validateUrl('http://api.localhost/hook'),
      ).rejects.toThrow(/SSRF_BLOCKED.*localhost/);
    });
  });

  describe('Blocked IPv4 Ranges', () => {
    it('should block IPv4 loopback 127.0.0.1', async () => {
      await expect(
        service.validateUrl('http://127.0.0.1:8080'),
      ).rejects.toThrow(/SSRF_BLOCKED/);
    });

    it('should block IPv4 loopback range 127.0.0.2', async () => {
      await expect(service.validateUrl('http://127.0.0.2')).rejects.toThrow(
        /SSRF_BLOCKED.*127\.0\.0\.0\/8/,
      );
    });

    it('should block RFC 1918 10.0.0.0/8', async () => {
      await expect(service.validateUrl('http://10.0.0.1')).rejects.toThrow(
        /SSRF_BLOCKED.*10\.0\.0\.0\/8/,
      );
    });

    it('should block RFC 1918 172.16.0.0/12 start (172.16.0.1)', async () => {
      await expect(service.validateUrl('http://172.16.0.1')).rejects.toThrow(
        /SSRF_BLOCKED.*172\.16\.0\.0\/12/,
      );
    });

    it('should block RFC 1918 172.16.0.0/12 end (172.31.255.254)', async () => {
      await expect(
        service.validateUrl('http://172.31.255.254'),
      ).rejects.toThrow(/SSRF_BLOCKED.*172\.16\.0\.0\/12/);
    });

    it('should block RFC 1918 192.168.0.0/16', async () => {
      await expect(service.validateUrl('http://192.168.1.1')).rejects.toThrow(
        /SSRF_BLOCKED.*192\.168\.0\.0\/16/,
      );
    });

    it('should block AWS metadata / link-local 169.254.169.254', async () => {
      await expect(
        service.validateUrl('http://169.254.169.254/latest/meta-data'),
      ).rejects.toThrow(/SSRF_BLOCKED.*169\.254\.0\.0\/16/);
    });

    it('should block link-local 169.254.1.1', async () => {
      await expect(service.validateUrl('http://169.254.1.1')).rejects.toThrow(
        /SSRF_BLOCKED.*169\.254\.0\.0\/16/,
      );
    });

    it('should block current network 0.0.0.0/8', async () => {
      await expect(service.validateUrl('http://0.0.0.0')).rejects.toThrow(
        /SSRF_BLOCKED.*0\.0\.0\.0\/8/,
      );
    });

    it('should block broadcast 255.255.255.255', async () => {
      await expect(
        service.validateUrl('http://255.255.255.255'),
      ).rejects.toThrow(/SSRF_BLOCKED.*255\.255\.255\.255/);
    });

    it('should block Carrier-grade NAT 100.64.0.0/10', async () => {
      await expect(service.validateUrl('http://100.64.0.1')).rejects.toThrow(
        /SSRF_BLOCKED.*100\.64\.0\.0\/10/,
      );
      await expect(
        service.validateUrl('http://100.127.255.254'),
      ).rejects.toThrow(/SSRF_BLOCKED.*100\.64\.0\.0\/10/);
    });
  });

  describe('Blocked IPv6 Ranges', () => {
    it('should block IPv6 loopback ::1', async () => {
      await expect(service.validateUrl('http://[::1]')).rejects.toThrow(
        /SSRF_BLOCKED.*::1/,
      );
      await expect(
        service.validateUrl('http://[::1]:8080/events'),
      ).rejects.toThrow(/SSRF_BLOCKED.*::1/);
    });

    it('should block IPv6 link-local fe80::/10', async () => {
      await expect(service.validateUrl('http://[fe80::1]')).rejects.toThrow(
        /SSRF_BLOCKED.*fe80::\/10/,
      );
      await expect(service.validateUrl('http://[febf::1]')).rejects.toThrow(
        /SSRF_BLOCKED.*fe80::\/10/,
      );
    });

    it('should block IPv6 unique local fc00::/7', async () => {
      await expect(service.validateUrl('http://[fc00::1]')).rejects.toThrow(
        /SSRF_BLOCKED.*fc00::\/7/,
      );
      await expect(
        service.validateUrl('http://[fd12:3456:789a::1]'),
      ).rejects.toThrow(/SSRF_BLOCKED.*fc00::\/7/);
    });

    it('should block IPv6 unspecified ::', async () => {
      await expect(service.validateUrl('http://[::]')).rejects.toThrow(
        /SSRF_BLOCKED.*::/,
      );
    });

    it('should block IPv4-mapped IPv6 loopback ::ffff:127.0.0.1', async () => {
      await expect(
        service.validateUrl('http://[::ffff:127.0.0.1]'),
      ).rejects.toThrow(/SSRF_BLOCKED/);
    });

    it('should block IPv4-mapped IPv6 private 10.0.0.1', async () => {
      await expect(
        service.validateUrl('http://[::ffff:10.0.0.1]'),
      ).rejects.toThrow(/SSRF_BLOCKED/);
    });

    it('should block IPv4-mapped IPv6 AWS metadata 169.254.169.254', async () => {
      await expect(
        service.validateUrl('http://[::ffff:169.254.169.254]'),
      ).rejects.toThrow(/SSRF_BLOCKED/);
    });
  });

  describe('DNS Resolution and DNS Rebinding Protection', () => {
    it('should block domains that resolve to loopback IP addresses (rebinding)', async () => {
      jest.spyOn(dns.promises, 'lookup').mockResolvedValue([
        { address: '127.0.0.1', family: 4 },
      ] as any);

      await expect(
        service.validateUrl('https://evil-domain.com/hook'),
      ).rejects.toThrow(/SSRF_BLOCKED.*127\.0\.0\.0\/8/);
    });

    it('should block domains that resolve to private 10.x.x.x addresses', async () => {
      jest.spyOn(dns.promises, 'lookup').mockResolvedValue([
        { address: '10.200.1.5', family: 4 },
      ] as any);

      await expect(
        service.validateUrl('https://internal.corp/hook'),
      ).rejects.toThrow(/SSRF_BLOCKED.*10\.0\.0\.0\/8/);
    });

    it('should block domains if any resolved IP in multi-A records is private', async () => {
      jest.spyOn(dns.promises, 'lookup').mockResolvedValue([
        { address: '93.184.216.34', family: 4 },
        { address: '192.168.1.50', family: 4 },
      ] as any);

      await expect(
        service.validateUrl('https://mixed-resolution.com/hook'),
      ).rejects.toThrow(/SSRF_BLOCKED.*192\.168\.0\.0\/16/);
    });

    it('should throw BadRequestException if hostname cannot be resolved', async () => {
      jest.spyOn(dns.promises, 'lookup').mockRejectedValue(new Error('ENOTFOUND'));

      await expect(
        service.validateUrl('https://non-existent-hostname-xyz.com'),
      ).rejects.toThrow(/SSRF_BLOCKED.*could not be resolved/);
    });
  });
});
