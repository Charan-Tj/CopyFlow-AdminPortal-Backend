import { Test, TestingModule } from '@nestjs/testing';
import { KiosksService } from './kiosks.service';

describe('KiosksService', () => {
  let service: KiosksService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [KiosksService],
    }).compile();

    service = module.get<KiosksService>(KiosksService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
