import { NextRequest, NextResponse } from 'next/server';

import {
  MolegApiConfigurationError,
  MolegApiResponseError,
  searchCurrentLaws,
} from '@/lib/moleg-law-api';

const MAX_QUERY_LENGTH = 100;
const MAX_PAGE = 1_000;

function errorResponse(message: string, status: 400 | 500 | 502 | 503) {
  return NextResponse.json(
    { success: false, error: { message } },
    { status },
  );
}
export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('query')?.trim() ?? '';
  if (!query) return errorResponse('검색할 법령명을 입력해 주세요.', 400);
  if (query.length > MAX_QUERY_LENGTH) {
    return errorResponse(`법령명은 ${MAX_QUERY_LENGTH}자 이하로 입력해 주세요.`, 400);
  }

  const pageText = request.nextUrl.searchParams.get('page') ?? '1';
  const page = Number.parseInt(pageText, 10);
  if (!Number.isInteger(page) || page < 1 || page > MAX_PAGE) {
    return errorResponse('검색 페이지 값이 올바르지 않습니다.', 400);
  }

  try {
    const result = await searchCurrentLaws(query, page);
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof MolegApiConfigurationError) {
      return errorResponse(error.message, 503);
    }
    if (error instanceof MolegApiResponseError) {
      return errorResponse(error.message, 502);
    }
    console.error('[laws/search] Unexpected error:', error);
    return errorResponse('법령 검색 중 예상하지 못한 오류가 발생했습니다.', 500);
  }
}
