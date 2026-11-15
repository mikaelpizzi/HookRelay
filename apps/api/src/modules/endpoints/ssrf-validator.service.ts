import { BadRequestException, Injectable } from '@nestjs/common';
import * as dns from 'node:dns';

export interface IpValidationResult {
  blocked: boolean;
  reason?: string;
}

@Injectable()
export class SsrfValidatorService {
  /**
   * Validates a target URL against SSRF attacks by enforcing HTTP/HTTPS protocols,
   * resolving hostnames to IP addresses, and blocking private, loopback, link-local,
   * carrier-grade NAT, and cloud metadata IP ranges.
   */
  async validateUrl(rawUrl: string): Promise<void> {
    if (!rawUrl || typeof rawUrl !== 'string') {
      throw new BadRequestException('SSRF_BLOCKED: URL is required and must be a string');
    }

    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new BadRequestException('SSRF_BLOCKED: Invalid URL format');
    }

    const protocol = parsed.protocol.toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') {
      throw new BadRequestException(
        `SSRF_BLOCKED: Protocol '${parsed.protocol.replace(':', '')}' is not allowed. Only HTTP and HTTPS are permitted`,
      );
    }

    const rawHostname = parsed.hostname;
    if (!rawHostname) {
      throw new BadRequestException('SSRF_BLOCKED: Hostname is required');
    }

    if (this.isAllowedLocalUrl(parsed)) {
      return;
    }

    const normalizedHost = rawHostname.toLowerCase();
    if (normalizedHost === 'localhost' || normalizedHost.endsWith('.localhost')) {
      throw new BadRequestException('SSRF_BLOCKED: Host resolves to blocked address (localhost)');
    }

    // Strip brackets from IPv6 hostnames like "[::1]"
    const cleanHost =
      normalizedHost.startsWith('[') && normalizedHost.endsWith(']')
        ? normalizedHost.slice(1, -1)
        : normalizedHost;

    let addresses: Array<{ address: string; family: number }> = [];

    try {
      addresses = await dns.promises.lookup(cleanHost, { all: true });
    } catch (error: any) {
      throw new BadRequestException(
        `SSRF_BLOCKED: Hostname '${cleanHost}' could not be resolved: ${error?.message || error}`,
      );
    }

    if (!addresses || addresses.length === 0) {
      throw new BadRequestException(
        `SSRF_BLOCKED: No IP addresses resolved for hostname '${cleanHost}'`,
      );
    }

    for (const record of addresses) {
      const result = this.checkIpAddress(record.address);
      if (result.blocked) {
        throw new BadRequestException(
          `SSRF_BLOCKED: Resolved address '${record.address}' is in forbidden range: ${result.reason}`,
        );
      }
    }
  }

  /**
   * Determines if a target URL is an allowed local endpoint (e.g. internal demo sink or local test mode).
   * Allows localhost / loopback addresses targeting demo sink routes, or any local endpoint if ALLOW_LOCAL_WEBHOOKS=true.
   */
  isAllowedLocalUrl(parsedUrl: URL): boolean {
    if (process.env.ALLOW_LOCAL_WEBHOOKS === 'true') {
      return true;
    }

    const rawHost = parsedUrl.hostname.toLowerCase();
    const cleanHost =
      rawHost.startsWith('[') && rawHost.endsWith(']')
        ? rawHost.slice(1, -1)
        : rawHost;

    const isLocalhost =
      cleanHost === 'localhost' ||
      cleanHost.endsWith('.localhost') ||
      cleanHost === '127.0.0.1' ||
      cleanHost === '::1';

    const path = parsedUrl.pathname.replace(/\/+$/, '');
    const isDemoSinkPath =
      path === '/api/demo/webhook-sink' ||
      path === '/api/v1/demo/webhook-sink';

    return isLocalhost && isDemoSinkPath;
  }

  /**
   * Evaluates an individual IP address (IPv4 or IPv6) against forbidden CIDR ranges.
   */
  checkIpAddress(ip: string): IpValidationResult {
    const v4 = this.parseIPv4(ip);
    if (v4) {
      return this.isForbiddenIPv4(v4);
    }

    const v6 = this.parseIPv6(ip);
    if (v6) {
      return this.isForbiddenIPv6(v6);
    }

    return { blocked: true, reason: `Invalid IP address format: ${ip}` };
  }

  /**
   * Parses an IPv4 string into 4 numerical octets [0..255]. Returns null if invalid.
   */
  private parseIPv4(ip: string): [number, number, number, number] | null {
    const parts = ip.split('.');
    if (parts.length !== 4) {
      return null;
    }

    const octets: number[] = [];
    for (const part of parts) {
      if (!/^\d+$/.test(part)) {
        return null;
      }
      const num = Number(part);
      if (num < 0 || num > 255) {
        return null;
      }
      octets.push(num);
    }

    return [octets[0], octets[1], octets[2], octets[3]];
  }

  /**
   * Checks whether the parsed IPv4 octets fall into reserved or private IP ranges.
   */
  private isForbiddenIPv4(octets: [number, number, number, number]): IpValidationResult {
    const [o0, o1, o2, o3] = octets;

    // Current network / zero: 0.0.0.0/8
    if (o0 === 0) {
      return { blocked: true, reason: 'Current network (0.0.0.0/8)' };
    }

    // Loopback: 127.0.0.0/8
    if (o0 === 127) {
      return { blocked: true, reason: 'Loopback address (127.0.0.0/8)' };
    }

    // RFC 1918 Private networks:
    // 10.0.0.0/8
    if (o0 === 10) {
      return { blocked: true, reason: 'Private RFC 1918 address (10.0.0.0/8)' };
    }
    // 172.16.0.0/12 (172.16.0.0 - 172.31.255.255)
    if (o0 === 172 && o1 >= 16 && o1 <= 31) {
      return { blocked: true, reason: 'Private RFC 1918 address (172.16.0.0/12)' };
    }
    // 192.168.0.0/16
    if (o0 === 192 && o1 === 168) {
      return { blocked: true, reason: 'Private RFC 1918 address (192.168.0.0/16)' };
    }

    // Link-local / Cloud metadata: 169.254.0.0/16
    if (o0 === 169 && o1 === 254) {
      return { blocked: true, reason: 'Link-local / cloud metadata address (169.254.0.0/16)' };
    }

    // Carrier-grade NAT: 100.64.0.0/10 (100.64.0.0 - 100.127.255.255)
    if (o0 === 100 && o1 >= 64 && o1 <= 127) {
      return { blocked: true, reason: 'Carrier-grade NAT address (100.64.0.0/10)' };
    }

    // Broadcast: 255.255.255.255
    if (o0 === 255 && o1 === 255 && o2 === 255 && o3 === 255) {
      return { blocked: true, reason: 'Broadcast address (255.255.255.255)' };
    }

    // Multicast: 224.0.0.0/4
    if (o0 >= 224 && o0 <= 239) {
      return { blocked: true, reason: 'Multicast address (224.0.0.0/4)' };
    }

    // Reserved / Future: 240.0.0.0/4
    if (o0 >= 240) {
      return { blocked: true, reason: 'Reserved address (240.0.0.0/4)' };
    }

    return { blocked: false };
  }

  /**
   * Parses an IPv6 string into 8 16-bit words. Supports :: compression and IPv4-mapped notation.
   */
  private parseIPv6(ip: string): number[] | null {
    let normalized = ip.toLowerCase();

    // Strip zone ID if present (e.g. fe80::1%eth0)
    const zoneIndex = normalized.indexOf('%');
    if (zoneIndex !== -1) {
      normalized = normalized.slice(0, zoneIndex);
    }

    // Handle embedded IPv4-mapped addresses like ::ffff:192.168.1.1
    if (normalized.includes('.')) {
      const lastColon = normalized.lastIndexOf(':');
      if (lastColon === -1) {
        return null;
      }
      const v4Part = normalized.slice(lastColon + 1);
      const v6Prefix = normalized.slice(0, lastColon);
      const v4 = this.parseIPv4(v4Part);
      if (!v4) {
        return null;
      }
      const high = (v4[0] << 8) | v4[1];
      const low = (v4[2] << 8) | v4[3];
      normalized = `${v6Prefix}:${high.toString(16)}:${low.toString(16)}`;
    }

    const parts = normalized.split('::');
    if (parts.length > 2) {
      return null;
    }

    const left = parts[0] ? parts[0].split(':').filter(Boolean) : [];
    const right = parts.length === 2 && parts[1] ? parts[1].split(':').filter(Boolean) : [];

    const missing = 8 - (left.length + right.length);
    if (missing < 0) {
      return null;
    }

    const middle = new Array(missing).fill('0');
    const full = [...left, ...middle, ...right];
    if (full.length !== 8) {
      return null;
    }

    const words: number[] = [];
    for (const hex of full) {
      if (!/^[0-9a-f]{1,4}$/i.test(hex)) {
        return null;
      }
      words.push(parseInt(hex, 16));
    }

    return words;
  }

  /**
   * Checks whether the parsed IPv6 words fall into reserved or private IPv6 ranges.
   */
  private isForbiddenIPv6(words: number[]): IpValidationResult {
    // IPv4-mapped IPv6: ::ffff:0:0/96
    if (
      words[0] === 0 &&
      words[1] === 0 &&
      words[2] === 0 &&
      words[3] === 0 &&
      words[4] === 0 &&
      words[5] === 0xffff
    ) {
      const octets: [number, number, number, number] = [
        (words[6] >> 8) & 0xff,
        words[6] & 0xff,
        (words[7] >> 8) & 0xff,
        words[7] & 0xff,
      ];
      const v4Result = this.isForbiddenIPv4(octets);
      if (v4Result.blocked) {
        return {
          blocked: true,
          reason: `IPv4-mapped IPv6 in forbidden range: ${v4Result.reason}`,
        };
      }
      return { blocked: false };
    }

    // Unspecified address: ::
    if (words.every((w) => w === 0)) {
      return { blocked: true, reason: 'Unspecified address (::)' };
    }

    // Loopback: ::1
    if (
      words[0] === 0 &&
      words[1] === 0 &&
      words[2] === 0 &&
      words[3] === 0 &&
      words[4] === 0 &&
      words[5] === 0 &&
      words[6] === 0 &&
      words[7] === 1
    ) {
      return { blocked: true, reason: 'Loopback address (::1)' };
    }

    // Link-local: fe80::/10 (fe80 to febf)
    // First 10 bits: 1111 1110 10 -> (word & 0xffc0) === 0xfe80
    if ((words[0] & 0xffc0) === 0xfe80) {
      return { blocked: true, reason: 'Link-local address (fe80::/10)' };
    }

    // Unique local: fc00::/7 (fc00 to fdff)
    // First 7 bits: 1111 110 -> (word & 0xfe00) === 0xfc00
    if ((words[0] & 0xfe00) === 0xfc00) {
      return { blocked: true, reason: 'Unique local address (fc00::/7)' };
    }

    return { blocked: false };
  }
}
