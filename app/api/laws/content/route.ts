import { NextRequest, NextResponse } from 'next/server';

import {
  fetchCurrentLaw,
  MolegApiConfigurationError,
  MolegApiResponseError,
} from '@/lib/moleg-law-api';

const DIGITS_ONLY = /^\d{1,20}$/u;

function errorResponse(message: string, status: 400 | 500 | 502 | 503) {
  return NextResponse.json(
    { success: false, error: { message } },
    { status },
  );
}
export async function GET(request: NextRequest) {
  const mst = request.nextUrl.searchParams.get('mst')?.trim() ?? '';
  const effectiveDate = request.nextUrl.searchParams.get('effectiveDate')?.trim() ?? '';
  if (!DIGITS_ONLY.test(mst) || !/^\d{8}$/u.test(effectiveDate)) {
    return errorResponse('선택한 법령 정보가 올바르지 않습니다.', 400);
  }

  try {
    const result = await fetchCurrentLaw(mst, effectiveDate);
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof MolegApiConfigurationError) {
      return errorResponse(error.message, 503);
    }
    if (error instanceof MolegApiResponseError) {
      return errorResponse(error.message, 502);
    }
    console.error('[laws/content] Unexpected error:', error);
    return errorResponse('법령 본문을 가져오는 중 예상하지 못한 오류가 발생했습니다.', 500);
  }
}
