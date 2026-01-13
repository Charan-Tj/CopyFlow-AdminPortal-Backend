import { Test, TestingModule } from '@nestjs/testing';
import { KiosksController } from './kiosks.controller';

describe('KiosksController', () => {
  let controller: KiosksController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [KiosksController],
    }).compile();

    controller = module.get<KiosksController>(KiosksController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
