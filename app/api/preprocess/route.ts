import { NextRequest, NextResponse } from 'next/server';

import { normalizePreprocessRequest } from '@/lib/preprocess-request';
import { preprocessExtractedDocument } from '@/lib/text-preprocessor';

function errorResponse(code: string, message: string, status: 400 | 500) {
  return NextResponse.json(
    { success: false, error: { code, message } },
    { status },
  );
}

export async function POST(request: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch (error) {
      if (error instanceof SyntaxError) {
        return errorResponse('INVALID_REQUEST', 'Request body must be valid JSON.', 400);
      }
      throw error;
    }

    const normalized = normalizePreprocessRequest(body);
    if (!normalized.ok) {
      return errorResponse(normalized.error.code, normalized.error.message, 400);
    }

    const result = preprocessExtractedDocument(
      normalized.value.document,
      normalized.value.docType,
    );

    return NextResponse.json({ success: true, data: result }, { status: 200 });
  } catch (error) {
    console.error('[preprocess] Unexpected preprocessing error:', error);
    return errorResponse(
      'PREPROCESSING_FAILED',
      error instanceof Error ? error.message : String(error),
      500,
    );
  }
}
