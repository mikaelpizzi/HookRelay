export type DemoSinkMode = 'HEALTHY' | 'DOWN' | 'SLOW';

export class SetModeDto {
  mode!: DemoSinkMode;
}
