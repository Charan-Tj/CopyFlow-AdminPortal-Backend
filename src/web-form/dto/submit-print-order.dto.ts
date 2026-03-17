import { IsString, IsIn, IsOptional, IsInt, Min, Max, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SubmitPrintOrderDto {
    @ApiProperty({ description: 'Customer phone number in E.164 format or 10-digit format', example: '+919876543210' })
    @Transform(({ value }) => {
        if (typeof value !== 'string') return value;
        const cleaned = value.replace(/\s+/g, '');
        if (/^\d{10}$/.test(cleaned)) {
            return '+91' + cleaned;
        }
        return cleaned;
    })
    @Matches(/^\+[1-9]\d{6,14}$/, {
        message: 'phone_number must be in international format with country code (e.g. +919876543210) or a 10-digit number',
    })
    phone_number: string;

    @ApiProperty({ description: 'Number of copies (1–99)', example: 1 })
    @Transform(({ value }) => parseInt(value, 10))
    @IsInt()
    @Min(1)
    @Max(99)
    copies: number;

    @ApiProperty({ description: 'Print color mode', enum: ['BW', 'COLOR'], example: 'BW' })
    @IsIn(['BW', 'COLOR'])
    color_mode: 'BW' | 'COLOR';

    @ApiProperty({ description: 'Print sides', enum: ['single', 'double'], example: 'single' })
    @IsIn(['single', 'double'])
    sides: 'single' | 'double';

    @ApiPropertyOptional({ description: 'Shop node code (leave empty to auto-assign)', example: 'TESTNODE1' })
    @IsOptional()
    @IsString()
    node_code?: string;
}
