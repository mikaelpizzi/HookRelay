import { Injectable, OnModuleDestroy } from '@nestjs/common';
import * as dns from 'node:dns';
import { performance } from 'node:perf_hooks';
import { Agent, buildConnector, Dispatcher, request } from 'undici';
import { SsrfValidatorService } from '../endpoints/ssrf-validator.service';
import { HmacSignerService } from './hmac-signer.service';

export interface WebhookDispatchOptions {
  url: string;
  payload: string;
  secret: string;
  deliveryId: string;
  eventId: string;
  correlationId: string;
  extraHeaders?: Record<string, string>;
}

export interface WebhookDispatchResult {
  success: boolean;
  statusCode?: number;
  responseBody?: string;
  latencyMs: number;
  errorCode?: string;
  errorMessage?: string;
}

const MAX_RESPONSE_BYTES = 64 * 1024; // 64 KB response body cap to avoid buffer exhaustion
const CONNECT_TIMEOUT_MS = 1500;
const HEADERS_TIMEOUT_MS = 5000;
const BODY_TIMEOUT_MS = 5000;

@Injectable()
export class SafeHttpTransport implements OnModuleDestroy {
  private dispatcher: Dispatcher;
  private localDispatcher: Dispatcher;
  private customDispatcherSet = false;

  constructor(
    private readonly ssrfValidator: SsrfValidatorService,
    private readonly hmacSigner: HmacSignerService,
  ) {
    this.dispatcher = this.createSecureAgent();
    this.localDispatcher = new Agent({
      connectTimeout: CONNECT_TIMEOUT_MS,
      headersTimeout: HEADERS_TIMEOUT_MS,
      bodyTimeout: BODY_TIMEOUT_MS,
      maxRedirections: 0,
    });
  }

  /**
   * Dispatches an HTTP POST webhook request with HMAC-SHA256 signature,
   * DNS pinning against SSRF / DNS rebinding, and strictly controlled timeouts.
   */
  async dispatchWebhook(
    options: WebhookDispatchOptions,
  ): Promise<WebhookDispatchResult> {
    const startTime = performance.now();

    // Pre-validate URL scheme and format
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(options.url);
    } catch (error: any) {
      const latencyMs = Math.round(performance.now() - startTime);
      return {
        success: false,
        latencyMs,
        errorCode: 'INVALID_URL',
        errorMessage: `Invalid URL format: ${error?.message || error}`,
      };
    }

    const protocol = parsedUrl.protocol.toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') {
      const latencyMs = Math.round(performance.now() - startTime);
      return {
        success: false,
        latencyMs,
        errorCode: 'SSRF_BLOCKED',
        errorMessage: `Protocol '${protocol.replace(':', '')}' is forbidden. Only HTTP and HTTPS are permitted`,
      };
    }

    // Direct check on IP literal or localhost hostname before making network requests
    const isLocalAllowed = this.ssrfValidator.isAllowedLocalUrl(parsedUrl);
    const rawHost = parsedUrl.hostname.toLowerCase();
    const cleanHost =
      rawHost.startsWith('[') && rawHost.endsWith(']')
        ? rawHost.slice(1, -1)
        : rawHost;

    if (!isLocalAllowed) {
      if (cleanHost === 'localhost' || cleanHost.endsWith('.localhost')) {
        const latencyMs = Math.round(performance.now() - startTime);
        return {
          success: false,
          latencyMs,
          errorCode: 'SSRF_BLOCKED',
          errorMessage: 'SSRF_BLOCKED: Host resolves to blocked address (localhost)',
        };
      }

      const directIpCheck = this.ssrfValidator.checkIpAddress(cleanHost);
      if (
        directIpCheck.blocked &&
        !directIpCheck.reason?.startsWith('Invalid IP address format')
      ) {
        const latencyMs = Math.round(performance.now() - startTime);
        return {
          success: false,
          latencyMs,
          errorCode: 'SSRF_BLOCKED',
          errorMessage: `SSRF_BLOCKED: Host '${cleanHost}' is in forbidden range: ${directIpCheck.reason}`,
        };
      }
    }

    // Generate cryptographic HMAC-SHA256 signature
    const signature = this.hmacSigner.signPayload(
      options.payload,
      options.secret,
    );

    // Assemble request headers: caller-provided extraHeaders cannot override security headers
    const headers: Record<string, string> = {
      ...options.extraHeaders,
      'User-Agent': 'HookRelay-Dispatcher/1.0',
      'Content-Type': 'application/json',
      'X-HookRelay-Signature': signature,
      'X-HookRelay-Delivery-Id': options.deliveryId,
      'X-HookRelay-Event-Id': options.eventId,
      'X-Correlation-Id': options.correlationId,
    };

    try {
      const targetDispatcher = this.customDispatcherSet
        ? this.dispatcher
        : isLocalAllowed
          ? this.localDispatcher
          : this.dispatcher;

      const response = await request(options.url, {
        method: 'POST',
        headers,
        body: options.payload,
        dispatcher: targetDispatcher,
        maxRedirections: 0,
        headersTimeout: HEADERS_TIMEOUT_MS,
        bodyTimeout: BODY_TIMEOUT_MS,
      });

      const latencyMs = Math.round(performance.now() - startTime);

      // Read response body safely with truncation cap at 64 KB
      const chunks: Buffer[] = [];
      let totalBytes = 0;

      for await (const chunk of response.body) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        if (totalBytes + buf.length > MAX_RESPONSE_BYTES) {
          const allowed = MAX_RESPONSE_BYTES - totalBytes;
          if (allowed > 0) {
            chunks.push(buf.subarray(0, allowed));
            totalBytes += allowed;
          }
          response.body.destroy();
          break;
        } else {
          chunks.push(buf);
          totalBytes += buf.length;
        }
      }

      const responseBody = Buffer.concat(chunks).toString('utf-8');
      const isSuccess = response.statusCode >= 200 && response.statusCode < 300;

      return {
        success: isSuccess,
        statusCode: response.statusCode,
        responseBody,
        latencyMs,
      };
    } catch (error: any) {
      const latencyMs = Math.round(performance.now() - startTime);
      const errMsg = error?.message || String(error);
      const errCode = error?.code;

      let errorCode = 'TRANSPORT_ERROR';
      if (errMsg.includes('SSRF_BLOCKED') || errCode === 'SSRF_BLOCKED') {
        errorCode = 'SSRF_BLOCKED';
      } else if (
        errCode === 'UND_ERR_CONNECT_TIMEOUT' ||
        errCode === 'UND_ERR_HEADERS_TIMEOUT' ||
        errCode === 'UND_ERR_BODY_TIMEOUT' ||
        errCode === 'ETIMEDOUT' ||
        error?.name === 'ConnectTimeoutError' ||
        error?.name === 'HeadersTimeoutError' ||
        error?.name === 'BodyTimeoutError'
      ) {
        errorCode = 'TIMED_OUT';
      } else if (errCode === 'ECONNREFUSED') {
        errorCode = 'CONNECTION_REFUSED';
      } else if (
        errCode === 'ENOTFOUND' ||
        errCode === 'EAI_AGAIN' ||
        errCode === 'EAI_NONAME'
      ) {
        errorCode = 'DNS_LOOKUP_FAILED';
      } else if (errCode === 'ECONNRESET') {
        errorCode = 'CONNECTION_RESET';
      } else if (errCode) {
        errorCode = errCode;
      }

      return {
        success: false,
        latencyMs,
        errorCode,
        errorMessage: errMsg,
      };
    }
  }

  /**
   * DNS Pinning lookup handler that verifies resolved IP addresses before connection establishment.
   * Defeats DNS Rebinding attacks by enforcing IP validation at socket creation time.
   */
  customLookup(
    hostname: string,
    options: any,
    callback?: (err: Error | null, addressOrAddresses?: any, family?: number) => void,
  ): void {
    let cb = callback;
    let opts = options;
    if (typeof options === 'function') {
      cb = options;
      opts = {};
    }
    if (!cb) return;

    const cleanHost =
      hostname.startsWith('[') && hostname.endsWith(']')
        ? hostname.slice(1, -1)
        : hostname;

    if (
      cleanHost.toLowerCase() === 'localhost' ||
      cleanHost.toLowerCase().endsWith('.localhost')
    ) {
      const err = new Error(
        'SSRF_BLOCKED: Host resolves to blocked address (localhost)',
      );
      (err as any).code = 'SSRF_BLOCKED';
      return cb(err);
    }

    dns.lookup(cleanHost, opts, (err, address, family) => {
      if (err) {
        return cb!(err);
      }

      if (opts && opts.all && Array.isArray(address)) {
        if (address.length === 0) {
          const noAddrErr = new Error(
            `SSRF_BLOCKED: No IP addresses resolved for hostname '${cleanHost}'`,
          );
          (noAddrErr as any).code = 'SSRF_BLOCKED';
          return cb!(noAddrErr);
        }

        for (const record of address) {
          const check = this.ssrfValidator.checkIpAddress(record.address);
          if (check.blocked) {
            const ssrfErr = new Error(
              `SSRF_BLOCKED: Resolved address '${record.address}' is in forbidden range: ${check.reason}`,
            );
            (ssrfErr as any).code = 'SSRF_BLOCKED';
            return cb!(ssrfErr);
          }
        }

        return cb!(null, address);
      } else {
        const ip = address as string;
        const check = this.ssrfValidator.checkIpAddress(ip);
        if (check.blocked) {
          const ssrfErr = new Error(
            `SSRF_BLOCKED: Resolved address '${ip}' is in forbidden range: ${check.reason}`,
          );
          (ssrfErr as any).code = 'SSRF_BLOCKED';
          return cb!(ssrfErr);
        }

        return cb!(null, address, family);
      }
    });
  }

  /**
   * Builds an undici Agent configured with custom connector, strict timeouts, and DNS Pinning.
   */
  private createSecureAgent(): Agent {
    const connector = buildConnector({
      lookup: this.customLookup.bind(this),
      timeout: CONNECT_TIMEOUT_MS,
    });

    return new Agent({
      connect: (opts: any, cb: (err: Error | null, socket: any) => void) => {
        const host = opts.hostname || opts.host;
        if (host) {
          const cleanHost =
            host.startsWith('[') && host.endsWith(']')
              ? host.slice(1, -1)
              : host;
          if (
            cleanHost === 'localhost' ||
            cleanHost.endsWith('.localhost')
          ) {
            const err = new Error(
              'SSRF_BLOCKED: Host resolves to blocked address (localhost)',
            );
            (err as any).code = 'SSRF_BLOCKED';
            return cb(err, null);
          }

          const check = this.ssrfValidator.checkIpAddress(cleanHost);
          if (
            check.blocked &&
            !check.reason?.startsWith('Invalid IP address format')
          ) {
            const err = new Error(
              `SSRF_BLOCKED: Target host '${cleanHost}' is in forbidden range: ${check.reason}`,
            );
            (err as any).code = 'SSRF_BLOCKED';
            return cb(err, null);
          }
        }
        return connector(opts, cb);
      },
      connectTimeout: CONNECT_TIMEOUT_MS,
      headersTimeout: HEADERS_TIMEOUT_MS,
      bodyTimeout: BODY_TIMEOUT_MS,
      maxRedirections: 0,
    });
  }

  setDispatcher(dispatcher: Dispatcher): void {
    this.dispatcher = dispatcher;
    this.customDispatcherSet = true;
  }

  getDispatcher(): Dispatcher {
    return this.dispatcher;
  }

  async onModuleDestroy(): Promise<void> {
    const destroyDispatcher = async (disp: any) => {
      if (typeof disp?.destroy === 'function') {
        try {
          await disp.destroy();
        } catch {
          if (typeof disp?.close === 'function') {
            await disp.close();
          }
        }
      } else if (typeof disp?.close === 'function') {
        await disp.close();
      }
    };

    await destroyDispatcher(this.dispatcher);
    await destroyDispatcher(this.localDispatcher);
  }
}
