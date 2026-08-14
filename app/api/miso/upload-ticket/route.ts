import { NextRequest, NextResponse } from 'next/server';

import { createSupabaseAdminClient, readSupabaseServerConfig } from '@/lib/supabase-admin';
import {
  TEMP_PDF_BUCKET,
  parsePdfUploadRequest,
} from '@/lib/pdf-upload-contract';
import {
  createPdfUploadTicket,
  type TemporaryPdfStorage,
} from '@/lib/supabase-pdf-server';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  let uploadRequest;
  try {
    uploadRequest = parsePdfUploadRequest(await request.json());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'PDF 업로드 정보가 올바르지 않습니다.' },
      { status: 400 },
    );
  }

  try {
    const { url } = readSupabaseServerConfig();
    const supabase = createSupabaseAdminClient();
    const storage = supabase.storage.from(TEMP_PDF_BUCKET) as unknown as TemporaryPdfStorage;
    const ticket = await createPdfUploadTicket(uploadRequest, storage, url);
    return NextResponse.json(ticket);
  } catch (error) {
    console.error('[pdf-upload] Failed to create upload ticket:', error);
    return NextResponse.json(
      { error: 'PDF 업로드 주소를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.' },
      { status: 500 },
    );
  }
}
