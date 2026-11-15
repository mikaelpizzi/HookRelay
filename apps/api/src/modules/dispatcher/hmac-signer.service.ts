import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';

export interface ParsedSignatureHeader {
  timestamp: number | null;
  signatures: string[];
}

@Injectable()
export class HmacSignerService {
  /**
   * Signs a raw webhook payload using HMAC-SHA256 with timestamp prefix.
   * Standard format: t={timestamp},v1={signature}
   */
  signPayload(rawBody: string, secret: string, timestamp?: number): string {
    const ts = timestamp ?? Math.floor(Date.now() / 1000);
    const toSign = `${ts}.${rawBody}`;
    const signature = crypto
      .createHmac('sha256', secret)
      .update(toSign)
      .digest('hex');

    return `t=${ts},v1=${signature}`;
  }

  /**
   * Verifies an incoming webhook signature header against the payload and secret.
   * Validates timestamp within [now - toleranceSec, now + toleranceSec] window.
   * Uses timing-safe constant-time comparison to protect against timing attacks.
   */
  verifySignature(
    rawBody: string,
    header: string,
    secret: string,
    toleranceSec = 300,
  ): boolean {
    if (
      typeof rawBody !== 'string' ||
      !header ||
      typeof header !== 'string' ||
      !secret ||
      typeof secret !== 'string'
    ) {
      return false;
    }

    const parsed = this.parseHeader(header);
    if (parsed.timestamp === null || parsed.signatures.length === 0) {
      return false;
    }

    const now = Math.floor(Date.now() / 1000);
    // Tolerate minor clock skew in past or future within tolerance window
    if (
      parsed.timestamp < now - toleranceSec ||
      parsed.timestamp > now + toleranceSec
    ) {
      return false;
    }

    const toSign = `${parsed.timestamp}.${rawBody}`;
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(toSign)
      .digest('hex');
    const expectedBuf = Buffer.from(expectedSignature, 'hex');

    for (const sig of parsed.signatures) {
      if (typeof sig !== 'string' || sig.length !== 64) {
        continue;
      }

      const sigBuf = Buffer.from(sig, 'hex');
      // Buffer length must match exactly before timingSafeEqual to avoid throwing RangeError
      if (
        sigBuf.length === expectedBuf.length &&
        crypto.timingSafeEqual(sigBuf, expectedBuf)
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Extracts the timestamp integer from a signature header string, or null if missing or invalid.
   */
  extractTimestamp(header: string): number | null {
    return this.parseHeader(header).timestamp;
  }

  /**
   * Parses standard signature header pairs (t=..., v1=...).
   * Supports comma-separated keys and multiple v1 signatures for secret rotation.
   */
  parseHeader(header: string): ParsedSignatureHeader {
    if (!header || typeof header !== 'string') {
      return { timestamp: null, signatures: [] };
    }

    let timestamp: number | null = null;
    const signatures: string[] = [];

    const pairs = header.split(',');
    for (const pair of pairs) {
      const trimmed = pair.trim();
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) {
        continue;
      }

      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();

      if (key === 't' && timestamp === null) {
        const parsed = parseInt(val, 10);
        if (!Number.isNaN(parsed) && parsed > 0) {
          timestamp = parsed;
        }
      } else if (key === 'v1' && val) {
        signatures.push(val);
      }
    }

    return { timestamp, signatures };
  }
}
