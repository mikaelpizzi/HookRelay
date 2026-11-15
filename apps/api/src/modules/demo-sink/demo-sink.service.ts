import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import * as crypto from 'node:crypto';
import { HmacSignerService } from '../dispatcher/hmac-signer.service';
import { DemoSinkMode } from './dto/set-mode.dto';

export { DemoSinkMode };

export interface DemoSinkLogItem {
  id: string;
  receivedAt: Date;
  headers: Record<string, any>;
  body: any;
  signatureValid: boolean | null;
  modeAtReceipt: DemoSinkMode;
  simulatedDelayMs?: number;
}

export interface WebhookProcessResult {
  received: boolean;
  signatureValid: boolean | null;
  simulatedDelayMs?: number;
}

@Injectable()
export class DemoSinkService {
  private mode: DemoSinkMode = 'HEALTHY';
  private readonly bufferCapacity = 50;
  private readonly logs: DemoSinkLogItem[] = [];
  private slowDelayMs = 6000;
  private defaultSigningSecret: string | null =
    process.env.DEMO_SINK_SECRET ?? null;

  constructor(private readonly hmacSigner: HmacSignerService) {}

  /**
   * Returns current simulation mode.
   */
  getMode(): { mode: DemoSinkMode } {
    return { mode: this.mode };
  }

  /**
   * Updates current simulation mode with strict input validation.
   */
  setMode(mode: DemoSinkMode): { mode: DemoSinkMode } {
    const normalized = (mode ? String(mode).toUpperCase() : '') as DemoSinkMode;
    if (
      normalized !== 'HEALTHY' &&
      normalized !== 'DOWN' &&
      normalized !== 'SLOW'
    ) {
      throw new BadRequestException(
        `Invalid mode '${mode}'. Allowed values: HEALTHY, DOWN, SLOW`,
      );
    }
    this.mode = normalized;
    return { mode: this.mode };
  }

  /**
   * Sets custom delay duration for SLOW mode (useful for testing without waiting full 6s).
   */
  setSlowDelayMs(delayMs: number): void {
    this.slowDelayMs = Math.max(0, delayMs);
  }

  /**
   * Sets or clears fallback signing secret.
   */
  setDefaultSigningSecret(secret: string | null): void {
    this.defaultSigningSecret = secret;
  }

  /**
   * Processes incoming webhook payload according to the active simulation mode,
   * validates HMAC signature when headers/secret are present, and logs the attempt in memory.
   */
  async processWebhook(
    headers: Record<string, any>,
    body: any,
    rawBody?: string,
    signingSecret?: string,
  ): Promise<WebhookProcessResult> {
    const currentMode = this.mode;
    const signatureValid = this.evaluateSignature(
      headers,
      body,
      rawBody,
      signingSecret,
    );

    const logEntry: DemoSinkLogItem = {
      id: crypto.randomUUID(),
      receivedAt: new Date(),
      headers: headers ?? {},
      body: body ?? null,
      signatureValid,
      modeAtReceipt: currentMode,
    };

    if (currentMode === 'DOWN') {
      this.pushLog(logEntry);
      throw new HttpException(
        'Service Unavailable (simulated)',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    if (currentMode === 'SLOW') {
      logEntry.simulatedDelayMs = this.slowDelayMs;
      this.pushLog(logEntry);
      if (this.slowDelayMs > 0) {
        await this.sleep(this.slowDelayMs);
      }
      return {
        received: true,
        signatureValid,
        simulatedDelayMs: this.slowDelayMs,
      };
    }

    // HEALTHY mode
    this.pushLog(logEntry);
    return {
      received: true,
      signatureValid,
    };
  }

  /**
   * Returns recorded logs up to capacity (50), ordered newest first.
   */
  getLogs(): DemoSinkLogItem[] {
    return [...this.logs];
  }

  /**
   * Clears the in-memory circular buffer.
   */
  clearLogs(): { cleared: boolean; count: number } {
    const count = this.logs.length;
    this.logs.length = 0;
    return { cleared: true, count };
  }

  /**
   * Pushes log item to front of circular buffer, evicting oldest item when capacity is exceeded.
   */
  private pushLog(entry: DemoSinkLogItem): void {
    this.logs.unshift(entry);
    if (this.logs.length > this.bufferCapacity) {
      this.logs.length = this.bufferCapacity;
    }
  }

  /**
   * Evaluates HMAC-SHA256 signature if secret and/or headers are provided.
   */
  private evaluateSignature(
    headers: Record<string, any>,
    body: any,
    rawBody?: string,
    signingSecret?: string,
  ): boolean | null {
    const secret =
      signingSecret ||
      this.defaultSigningSecret ||
      process.env.DEMO_SINK_SECRET ||
      null;

    const normalizedHeaders: Record<string, string> = {};
    for (const [key, val] of Object.entries(headers || {})) {
      normalizedHeaders[key.toLowerCase()] = String(val);
    }

    const sigHeader =
      normalizedHeaders['x-hookrelay-signature'] ||
      normalizedHeaders['x-webhook-signature'] ||
      normalizedHeaders['x-signature'] ||
      normalizedHeaders['x-hub-signature-256'];

    if (!secret && !sigHeader) {
      return null;
    }

    if (secret && !sigHeader) {
      return false;
    }

    if (!secret && sigHeader) {
      return null;
    }

    const payload =
      typeof rawBody === 'string'
        ? rawBody
        : typeof body === 'string'
          ? body
          : JSON.stringify(body ?? {});

    return this.hmacSigner.verifySignature(payload, sigHeader!, secret!);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
