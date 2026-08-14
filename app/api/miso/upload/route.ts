import { NextRequest, NextResponse } from 'next/server';

import { createSupabaseAdminClient } from '@/lib/supabase-admin';
import { TEMP_PDF_BUCKET } from '@/lib/pdf-upload-contract';
import {
  uploadStoredPdfToMiso,
  type TemporaryPdfStorage,
} from '@/lib/supabase-pdf-server';

// 큰 파일 업로드(최대 50MB)를 지원하기 위해 Node.js 런타임 사용
export const runtime = 'nodejs';
export const maxDuration = 300;

interface MisoUploadResponse {
  id: string;
}

/**
 * 미소 파일 업로드 API 엔드포인트
 */
export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') || '';

    let file: File | null = null;
    let stagedPdf: { storagePath: string; fileName: string } | null = null;

    // 1) multipart/form-data 방식 (브라우저 파일 업로드)
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      file = formData.get('file') as File | null;
    }
    // 2) application/json 방식 ({ text, fileName } 형태의 본문)
    else if (contentType.includes('application/json')) {
      const body = (await request.json()) as {
        text?: string;
        fileName?: string;
        storagePath?: string;
      };

      if (
        typeof body.storagePath === 'string'
        && body.storagePath.trim().length > 0
        && typeof body.fileName === 'string'
        && body.fileName.trim().length > 0
      ) {
        stagedPdf = {
          storagePath: body.storagePath.trim(),
          fileName: body.fileName.trim(),
        };
      } else if (!body.text || typeof body.text !== 'string') {
        return NextResponse.json(
          {
            error: 'JSON 요청에는 임시 PDF 경로 또는 text 값이 필요합니다.',
          },
          { status: 400 },
        );
      } else {
        const name =
          typeof body.fileName === 'string' && body.fileName.trim().length > 0
            ? body.fileName.trim()
            : 'document.txt';

        // 텍스트를 가상의 파일로 래핑하여 미소 업로드 API에 전달
        file = new File([body.text], name, {
          type: 'text/plain;charset=utf-8',
        });
      }
    } else {
      return NextResponse.json(
        {
          error:
            '지원하지 않는 Content-Type입니다. multipart/form-data 또는 application/json을 사용해주세요.',
        },
        { status: 400 },
      );
    }

    if (!file && !stagedPdf) {
      return NextResponse.json(
        { error: '파일이 제공되지 않았습니다.' },
        { status: 400 },
      );
    }

    // 미소 스펙에 맞춘 최대 업로드 크기 (50MB)
    const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB
    if (file && file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        {
          error:
            '파일 용량이 50MB를 초과했습니다. 50MB 이하 파일만 업로드할 수 있습니다.',
        },
        { status: 400 },
      );
    }

    const apiKey = process.env.MISO_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            'MISO API 키가 설정되지 않았습니다.\n해결방안: 프로젝트 루트의 .env.local 파일에 MISO_API_KEY를 추가하고 서버를 다시 시작해주세요.',
        },
        { status: 500 },
      );
    }

    const misoEndpoint =
      process.env.NEXT_PUBLIC_MISO_ENDPOINT ??
      'https://api.holdings.miso.gs';

    if (stagedPdf) {
      const supabase = createSupabaseAdminClient();
      const storage = supabase.storage.from(TEMP_PDF_BUCKET) as unknown as TemporaryPdfStorage;
      const uploadData = await uploadStoredPdfToMiso({
        storagePath: stagedPdf.storagePath,
        fileName: stagedPdf.fileName,
        storage,
        misoEndpoint,
        apiKey,
      });
      return NextResponse.json({ success: true, ...uploadData });
    }

    if (!file) {
      return NextResponse.json({ error: '파일이 제공되지 않았습니다.' }, { status: 400 });
    }

    // 미소 파일 업로드 API로 전송
    const uploadFormData = new FormData();
    uploadFormData.append('file', file);
    uploadFormData.append('user', 'rag-preprocessor');

    const uploadResponse = await fetch(
      `${misoEndpoint}/ext/v1/files/upload`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: uploadFormData,
      },
    );

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      console.error('[v0] File upload error:', errorText);
      return NextResponse.json(
        {
          error: `파일 업로드 실패: ${errorText}`,
        },
        { status: uploadResponse.status },
      );
    }

    const uploadData = (await uploadResponse.json()) as MisoUploadResponse;

    return NextResponse.json({
      success: true,
      fileId: uploadData.id,
      fileName: file.name,
    });
  } catch (error) {
    console.error('[v0] File upload error:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : '파일 업로드 중 오류가 발생했습니다.',
      },
      { status: 500 },
    );
  }
}
