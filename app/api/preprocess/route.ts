import { NextRequest, NextResponse } from 'next/server';
import {
  normalizeDocType,
  preprocessByDocType,
} from '@/lib/text-preprocessor';

export async function POST(request: NextRequest) {
  try {
    // JSON 데이터 파싱
    const body = await request.json();
    
    // 텍스트 데이터 추출
    const { text, docType, separator } = body as {
      text?: string;
      docType?: unknown;
      separator?: string;
    };
    
    // 입력 검증
    if (!text || typeof text !== 'string') {
      return NextResponse.json(
        { error: '유효한 텍스트 데이터가 필요합니다.' },
        { status: 400 }
      );
    }
    
    if (text.trim().length === 0) {
      return NextResponse.json(
        { error: '빈 텍스트는 처리할 수 없습니다.' },
        { status: 400 }
      );
    }
    
    const effectiveDocType = normalizeDocType(docType);
    
    // 구분자 기본값 설정
    const effectiveSeparator = separator || '@@@';
    
    // 전처리 실행
    const result = preprocessByDocType(text, effectiveDocType, effectiveSeparator);
    
    // 결과 반환
    return NextResponse.json({
      success: true,
      data: {
        processedText: result.processedText,
        chunks: result.chunks,
        stats: result.stats,
      },
    });
    
  } catch (error) {
    console.error('[v0] Preprocessing error:', error);
    
    return NextResponse.json(
      { 
        error: '텍스트 전처리 중 오류가 발생했습니다.',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
