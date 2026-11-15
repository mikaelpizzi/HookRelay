import { Test, TestingModule } from '@nestjs/testing';
import { DemoSinkController } from './demo-sink.controller';
import { DemoSinkService } from './demo-sink.service';
import { HmacSignerService } from '../dispatcher/hmac-signer.service';

describe('DemoSinkController', () => {
  let controller: DemoSinkController;
  let service: DemoSinkService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DemoSinkController],
      providers: [DemoSinkService, HmacSignerService],
    }).compile();

    controller = module.get<DemoSinkController>(DemoSinkController);
    service = module.get<DemoSinkService>(DemoSinkService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
    expect(service).toBeDefined();
  });

  describe('receiveWebhook', () => {
    it('processes incoming webhook and returns 200 result', async () => {
      const headers = { 'x-hookrelay-signature': 'sig123' };
      const body = { test: true };
      const req = { rawBody: Buffer.from(JSON.stringify(body)) };

      const result = await controller.receiveWebhook(
        headers,
        body,
        req,
        'my_secret',
      );

      expect(result.received).toBe(true);
      expect(controller.getLogs()).toHaveLength(1);
    });

    it('uses x-demo-secret header when query secret is absent', async () => {
      const headers = {
        'x-demo-secret': 'header_secret',
        'x-hookrelay-signature': 'sig',
      };
      const body = { msg: 'hello' };
      const req = {};

      const spy = jest.spyOn(service, 'processWebhook');
      await controller.receiveWebhook(headers, body, req);

      expect(spy).toHaveBeenCalledWith(
        headers,
        body,
        JSON.stringify(body),
        'header_secret',
      );
    });
  });

  describe('getMode & setMode', () => {
    it('returns default mode as HEALTHY', () => {
      expect(controller.getMode()).toEqual({ mode: 'HEALTHY' });
    });

    it('updates mode via setMode', () => {
      expect(controller.setMode({ mode: 'DOWN' })).toEqual({ mode: 'DOWN' });
      expect(controller.getMode()).toEqual({ mode: 'DOWN' });

      expect(controller.setMode({ mode: 'SLOW' })).toEqual({ mode: 'SLOW' });
      expect(controller.getMode()).toEqual({ mode: 'SLOW' });
    });
  });

  describe('getLogs & clearLogs', () => {
    it('returns logs and clears them', async () => {
      await controller.receiveWebhook({}, { ping: 1 }, {});
      await controller.receiveWebhook({}, { ping: 2 }, {});

      expect(controller.getLogs()).toHaveLength(2);

      const clearResult = controller.clearLogs();
      expect(clearResult).toEqual({ cleared: true, count: 2 });
      expect(controller.getLogs()).toHaveLength(0);
    });
  });
});
