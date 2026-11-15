import { HttpException, HttpStatus } from '@nestjs/common';

export class BackpressureException extends HttpException {
  public readonly headers: Record<string, string> = {
    'Retry-After': '10',
  };

  constructor(
    message = 'System under high backpressure. Queue limit exceeded.',
  ) {
    super(message, HttpStatus.TOO_MANY_REQUESTS);
  }
}
