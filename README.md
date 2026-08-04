# RAG 데이터 전처리 시스템 (RAG Data Preprocessor)

RAG(Retrieval-Augmented Generation) 시스템의 지식 베이스 구축을 위해, 다양한 형태의 문서(PDF, Excel, 법령 등)를 LLM이 이해하기 쉬운 형태의 청크(Chunk)로 변환하고 시각화하여 검증하는 웹 애플리케이션입니다.

## 🌟 주요 기능

- **다양한 문서 지원**: PDF, Excel, HWP, Markdown 등 다양한 포맷의 텍스트 추출
- **문서 유형별 최적화**:
  - **법령·사규**: 편/장/절/관/조 및 부칙 구조 인식과 보존
  - **엑셀·내부 데이터**: 시트별 분리 및 마크다운 표 변환, 헤더 반복 삽입
  - **설명서·업무 매뉴얼**: 소제목과 작업 절차 단위 분할
  - **일반 문서·보고서**: 문단 기반 분할과 마크다운 표 보존
- **전처리 파이프라인**: 텍스트 정제(Normalization) -> 구조 분석 -> 청킹(Chunking)
- **시각화 도구**:
  - **Progress Stepper**: 단계별 작업 흐름 가이드
  - **Chunk Flow Viewer**: 청크 간의 흐름과 오버랩(Overlap) 시각화
  - **Markdown Preview**: 전처리 결과 실시간 미리보기 및 편집

## 🛠 기술 스택

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **UI Components**: shadcn/ui (Radix UI 기반)
- **State Management**: React Hooks (`useFileProcessor`)
- **Visualizations**: React Flow (청크 시각화)
- **Markdown**: `react-markdown`, `remark-gfm`
- **Backend (Optional)**: Python (FastAPI/Flask) for specialized parsing features

## 📂 프로젝트 구조

```bash
├── app/
│   ├── page.tsx           # 메인 페이지 (단계별 워크플로우 진입점)
│   ├── layout.tsx         # 루트 레이아웃
│   └── api/               # Next.js API Routes (파일 업로드 등)
├── components/
│   ├── ui/                # shadcn/ui 디자인 컴포넌트
│   ├── chunk-flow-viewer.tsx  # 청크 흐름 시각화 컴포넌트
│   └── ...
├── hooks/
│   └── useFileProcessor.ts    # 파일 처리 핵심 로직 및 상태 관리
├── lib/
│   └── text-preprocessor.ts   # 전처리/청킹 알고리즘 (문서 유형별 전략)
└── workers/
    └── file.worker.ts     # 대용량 파일 처리를 위한 Web Worker
```

## 🚀 시작하기

### 1. 설치

```bash
pnpm install
# or
npm install
```

### 2. 실행

```bash
pnpm dev
# or
npm run dev
```

브라우저에서 `http://localhost:3000`으로 접속하여 확인합니다.

