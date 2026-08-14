import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 300;

interface MisoWorkflowRunData {
  id: string;
  workflow_id: string;
  status: string;
  outputs: Record<string, unknown>;
  error: string | null;
  total_steps: number;
  total_tokens: number;
  created_at: number | string;
  finished_at: number | string;
  elapsed_time: number;
}

interface MisoWorkflowResponse {
  task_id: string;
  workflow_run_id: string;
  data: MisoWorkflowRunData;
}

interface MisoRequestBody {
  fileId?: string;
  fileName?: string;
  input?: string;
}

/**
 * 미소 워크플로우 실행 API 엔드포인트
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as MisoRequestBody;
    const { fileId, fileName, input } = body;

    if (!input && !fileId) {
      return NextResponse.json(
        {
          error:
            '입력 텍스트(input) 또는 파일 정보(fileId, fileName) 중 하나는 반드시 제공되어야 합니다.',
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

    console.log('[v0] Calling MISO workflow with inputs', {
      hasInput: Boolean(input),
      hasFile: Boolean(fileId && fileName),
    });

    // MISO 모듈/워크플로우 명세에 따라,
    // - 일반 텍스트 변수: 문자열 그대로 전달
    // - 파일 타입 변수: files 항목에서 설명한 형식의 객체를 inputs에 그대로 넣어야 함
    const inputsPayload: Record<string, unknown> = {};

    if (typeof input === 'string') {
      inputsPayload.input = input;
    }

    // 파일이 함께 전달된 경우: 업로드한 파일을 MISO의 "input" 변수(파일 타입)에 매핑
    if (fileId && fileName) {
      // 지원되는 파일 타입 확인
      const documentExts = [
        'txt',
        'md',
        'markdown',
        'pdf',
        'html',
        'xlsx',
        'xls',
        'docx',
        'csv',
        'eml',
        'msg',
        'pptx',
        'ppt',
        'xml',
        'epub',
      ];
      const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'];
      const audioExts = ['mp3', 'm4a', 'wav', 'webm', 'amr'];
      const videoExts = ['mp4', 'mov', 'mpeg', 'mpga'];

      const fileExt = fileName.split('.').pop()?.toLowerCase() ?? '';

      let fileType: 'document' | 'image' | 'audio' | 'video' | 'custom';
      if (documentExts.includes(fileExt)) {
        fileType = 'document';
      } else if (imageExts.includes(fileExt)) {
        fileType = 'image';
      } else if (audioExts.includes(fileExt)) {
        fileType = 'audio';
      } else if (videoExts.includes(fileExt)) {
        fileType = 'video';
      } else {
        fileType = 'custom';
      }

      // 파일 타입 변수용 객체 (명세의 files 항목 형식을 그대로 사용)
      const fileInputValue = {
        type: fileType,
        transfer_method: 'local_file' as const,
        upload_file_id: fileId,
      };

      // 요구사항: "사용자가 홈페이지에 업로드한 파일이 미소 입력변수 input으로 간다"
      // → input 변수가 파일 타입인 워크플로우를 가정하고, 업로드 파일을 그대로 매핑
      inputsPayload.input = fileInputValue;
    }

    if (Object.keys(inputsPayload).length === 0) {
      return NextResponse.json(
        {
          error:
            'MISO 워크플로우에 전달할 입력이 없습니다. input 문자열 또는 업로드 파일을 제공해주세요.',
        },
        { status: 400 },
      );
    }

    // MISO 워크플로우 실행 요청 (blocking 모드)
    const misoResponse = await fetch(
      `${misoEndpoint}/ext/v1/workflows/run`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          // inputs 객체에 텍스트/파일 변수를 모두 포함
          inputs: inputsPayload,
          mode: 'blocking', // 명세 상 blocking / streaming 중 blocking 사용
          user: 'rag-preprocessor', // 최종 사용자 식별자 (통계/조회용)
        }),
      },
    );

    if (!misoResponse.ok) {
      const errorText = await misoResponse.text();
      console.error('[v0] MISO workflow error:', errorText);

      let errorData: { code?: string; message?: string } = {};
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { message: errorText };
      }

      const errorMessage = getErrorMessage(
        misoResponse.status,
        errorData.code ?? null,
        errorData.message,
      );
      return NextResponse.json(
        { error: errorMessage },
        { status: misoResponse.status },
      );
    }

    const misoData: MisoWorkflowResponse = await misoResponse.json();
    console.log('[v0] MISO workflow response:', misoData);

    const run = misoData.data;

    if (run.status !== 'succeeded') {
      return NextResponse.json(
        {
          error: `워크플로우 실행 실패: ${
            run.error ?? '알 수 없는 오류'
          }`,
        },
        { status: 500 },
      );
    }

    // outputs 안에서 result 키를 우선적으로 찾고, 없으면 전체 outputs를 문자열로 직렬화
    const outputs = run.outputs as { result?: unknown } & Record<
      string,
      unknown
    >;
    const resultText =
      typeof outputs.result === 'string'
        ? outputs.result
        : JSON.stringify(outputs);

    return NextResponse.json({
      success: true,
      data: {
        result: resultText,
        metadata: {
          workflowId: run.workflow_id,
          workflowRunId: misoData.workflow_run_id,
          taskId: misoData.task_id,
          elapsedTime: run.elapsed_time,
          totalTokens: run.total_tokens,
        },
      },
    });
  } catch (error) {
    console.error('[v0] MISO API error:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : '미소 API 호출 중 오류가 발생했습니다.',
      },
      { status: 500 },
    );
  }
}

/**
 * 에러 메시지 및 해결방안 반환
 */
function getErrorMessage(
  status: number,
  errorCode: string | null,
  message?: string,
): string {
  const errorMap: Record<
    string,
    { message: string; solution: string }
  > = {
    invalid_param: {
      message: '잘못된 파라미터가 입력되었습니다.',
      solution: '입력한 파일과 설정을 확인해주세요.',
    },
    workflow_not_published: {
      message: '워크플로우가 발행되지 않았습니다.',
      solution: '미소 앱 편집화면에서 저장 버튼을 눌러주세요.',
    },
    app_unavailable: {
      message: '앱 설정 정보를 사용할 수 없습니다.',
      solution: '미소 앱 설정을 확인하고 다시 시도해주세요.',
    },
    provider_not_initialize: {
      message: '사용 가능한 모델 인증 정보가 없습니다.',
      solution: '미소 앱에서 AI 모델 설정을 확인해주세요.',
    },
    provider_quota_exceeded: {
      message: '모델 호출 쿼터가 초과되었습니다.',
      solution: '잠시 후 다시 시도하거나 플랜을 업그레이드해주세요.',
    },
    model_currently_not_support: {
      message: '현재 모델을 사용할 수 없습니다.',
      solution: '다른 모델을 선택하거나 나중에 다시 시도해주세요.',
    },
    workflow_request_error: {
      message: '워크플로우 실행에 실패했습니다.',
      solution: '입력 데이터를 확인하고 다시 시도해주세요.',
    },
    internal_server_error: {
      message: '서버 내부 오류가 발생했습니다.',
      solution: '잠시 후 다시 시도해주세요.',
    },
  };

  const baseError =
    errorCode && errorMap[errorCode]
      ? `${errorMap[errorCode].message}\n해결방안: ${errorMap[errorCode].solution}`
      : `미소 API 호출 실패 (상태 코드: ${status})`;

  if (message) {
    return `${baseError}\n상세: ${message}`;
  }

  return baseError;
}
