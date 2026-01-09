import { IsEnum, IsInt, Min } from 'class-validator';
import { ColorMode } from '@prisma/client';

export class CreateJobDto {
  @IsInt()
  @Min(1)
  page_count: number;

  @IsEnum(ColorMode)
  color_mode: ColorMode;
}
