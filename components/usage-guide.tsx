import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Download,
  FileCheck2,
  FileText,
  ScanText,
  Settings2,
  Upload,
} from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DOCUMENT_HANDLING_SECURITY_NOTICE,
  DOCUMENT_HANDLING_STAGES,
  TABLE_HANDLING_GUIDANCE,
} from '@/lib/document-handling-guide';
import {
  getFileProcessingDisclosure,
  LOCAL_DOCX_EXTENSIONS,
  LOCAL_EXCEL_EXTENSIONS,
  LOCAL_TEXT_EXTENSIONS,
  MAX_FILE_SIZE_BYTES,
  MISO_DOCUMENT_EXTENSIONS,
  MISO_IMAGE_EXTENSIONS,
} from '@/lib/file-processing-policy';
import { HELP_TABS, type HelpSectionId } from '@/lib/help-guide-layout';
import { EXCEL_PREPROCESS_HELP_GUIDANCE } from '@/lib/preprocess-limits';

const maxFileSizeMb = MAX_FILE_SIZE_BYTES / 1024 / 1024;

const steps = [
  {
    icon: Upload,
    title: '자료 가져오기',
    description: '파일 하나를 업로드하거나 현행 법령을 검색해 원문을 가져옵니다.',
  },
  {
    icon: ScanText,
    title: '텍스트 추출 확인',
    description: '누락·깨짐·불필요한 문구가 없는지 원문과 비교합니다.',
  },
  {
    icon: Settings2,
    title: '전처리 설정',
    description: '문서 종류를 선택하면 고정 구분자 @@@와 안전 상한 3,800자로 자동 처리합니다.',
  },
  {
    icon: FileCheck2,
    title: '결과 검토',
    description: '청크 경계와 제목 문맥을 확인하고 필요하면 직접 수정합니다.',
  },
  {
    icon: Download,
    title: 'TXT 다운로드',
    description: '완성된 TXT를 내려받아 MISO RAG에 직접 등록합니다.',
  },
];

const commonDocumentRules = [
  '페이지 번호는 원문 대조를 위해 남기고, 페이지 주변에서 반복되는 짧은 머리말·꼬리말은 첫 번째만 남깁니다.',
  '각 청크에 문서명과 위치·섹션·시트처럼 검색에 필요한 문맥을 붙입니다.',
  'MISO 구분자는 @@@로 고정하며, 원문의 @@@는 구분자와 충돌하지 않게 바꿉니다.',
  'MISO의 4,000자 제한에 대비해 청크당 3,800자를 안전 상한으로 사용합니다.',
  '표와 반복되는 업무 문장은 최대한 보존하고, 원문에 없는 “(계속)” 문구를 만들지 않습니다.',
];

const documentTypes = [
  {
    name: '법령·사규',
    selection: '편·장·절·관·조, 부칙·별표·별지처럼 규정 계층이 중심인 문서',
    rules: '전체 계층과 조문 위치를 문맥으로 붙이고, 긴 조문은 항·호 등 자연스러운 경계를 우선해 나눕니다. 표도 해당 위치 문맥과 함께 보존합니다.',
  },
  {
    name: '엑셀·내부 데이터',
    selection: '행과 열로 구성된 표 데이터나 여러 시트가 있는 통합문서',
    rules: '시트와 빈 행으로 구분된 표 영역을 섞지 않습니다. 저장된 반복 머리행을 우선 사용하고, 없으면 자동 감지하며, 머리행 범위와 수식 출력 여부를 직접 수정할 수 있습니다.',
  },
  {
    name: '설명서·업무 매뉴얼',
    selection: '소제목, 번호 단계, 작업 절차, 주의·경고 문구가 중심인 문서',
    rules: '섹션과 작업 단계를 기준으로 묶고 주의·안전 문구를 인접한 작업과 함께 유지합니다. 표에는 해당 섹션 문맥을 붙입니다.',
  },
  {
    name: '일반 문서·보고서',
    selection: '보고서, 회의자료, 계약서 등 나머지 일반 문서',
    rules: '제목·문단·목록·표 경계를 기준으로 나눕니다. 구조화된 DOCX 계약서는 중복 조문 목차를 정리하고 완전한 조문과 조문 문맥을 우선 보존합니다.',
  },
];

const fileRoutes = [
  {
    category: '텍스트·데이터',
    extensions: LOCAL_TEXT_EXTENSIONS,
    disclosure: getFileProcessingDisclosure('local-text'),
  },
  {
    category: '엑셀',
    extensions: LOCAL_EXCEL_EXTENSIONS,
    disclosure: getFileProcessingDisclosure('local-excel'),
  },
  {
    category: 'DOCX',
    extensions: LOCAL_DOCX_EXTENSIONS,
    disclosure: getFileProcessingDisclosure('local-docx'),
  },
  {
    category: '문서',
    extensions: MISO_DOCUMENT_EXTENSIONS,
    disclosure: getFileProcessingDisclosure('miso'),
  },
  {
    category: '이미지',
    extensions: MISO_IMAGE_EXTENSIONS,
    disclosure: getFileProcessingDisclosure('miso'),
  },
];

function ExtensionList({ extensions }: { extensions: readonly string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {extensions.map((extension) => (
        <Badge key={extension} variant="secondary" className="font-mono uppercase">
          {extension}
        </Badge>
      ))}
    </div>
  );
}

function NecessityGuide() {
  return (
    <Card className="border-primary/40 bg-primary/[0.03]">
      <CardHeader>
        <CardTitle id="usage-guide-title">왜 문서 전처리가 필요한가요?</CardTitle>
        <CardDescription className="text-sm leading-6">
          문서를 등록하는 것만으로 AI가 그 안의 모든 내용을 완전히 기억하고 이해하는 것은 아닙니다.
          AI가 필요한 내용을 정확히 찾을 수 있도록 문서의 구조와 내용 단위를 정리해야 합니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <Alert className="border-amber-300 bg-amber-50/70 dark:bg-amber-950/20">
          <AlertTitle className="line-clamp-none leading-6">
            MISO RAG는 문서를 등록만 하면 모든 지식을 습득하는 만능 도구가 아닙니다.
          </AlertTitle>
          <AlertDescription className="leading-6">
            질문할 때마다 문서 전체를 읽는 것이 아니라, 질문과 관련 있다고 판단한 일부 내용만 찾아 AI에게 전달합니다.
            필요한 내용이 잘못 나뉘거나 검색되지 않으면 문서 안에 정답이 있어도 답변에 활용되지 않을 수 있습니다.
          </AlertDescription>
        </Alert>

        <div className="rounded-lg border bg-background p-4 sm:p-5">
          <div className="mb-5 rounded-lg bg-primary/5 p-4">
            <p className="font-semibold">청크란 무엇인가요?</p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              청크(chunk)는 RAG가 검색하는 기본 단위로, 긴 문서를 의미가 이어지는 작은 내용 묶음으로 나눈 것입니다.
              조문 하나, 표의 일부, 설명서의 한 절 등이 하나의 청크가 될 수 있습니다.
            </p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              질문이 들어오면 MISO RAG는 문서 전체가 아니라 관련성이 높은 청크를 찾아 AI에게 전달합니다.
              좋은 청크는 한 가지 주제를 담고 제목·조문 번호·표 머리말 같은 맥락을 포함해,
              해당 청크만 읽어도 어떤 내용인지 이해할 수 있어야 합니다.
            </p>
          </div>

          <ol className="grid gap-3 md:grid-cols-3">
            <li className="min-w-0 rounded-lg bg-muted/50 p-4">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">1</span>
                <p className="font-semibold">문서를 작은 내용 단위로 나눕니다.</p>
              </div>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                제목과 문맥이 이어지도록 관련 내용을 함께 묶습니다.
              </p>
            </li>
            <li className="min-w-0 rounded-lg bg-muted/50 p-4">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">2</span>
                <p className="font-semibold">질문과 가까운 청크만 찾습니다.</p>
              </div>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                문서 전체가 아니라 관련성이 높은 일부만 선택합니다.
              </p>
            </li>
            <li className="min-w-0 rounded-lg bg-muted/50 p-4">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">3</span>
                <p className="font-semibold">검색된 내용으로 답변합니다.</p>
              </div>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                검색되지 않은 내용은 답변에 사용되지 않을 수 있습니다.
              </p>
            </li>
          </ol>
        </div>

        <div className="overflow-hidden rounded-lg border bg-background">
          {[
            ['내용 단위가 너무 크면', '서로 다른 주제가 섞여 정확한 내용을 찾기 어려워집니다.'],
            ['내용 단위가 너무 작거나 제목이 없으면', '조항·업무·표의 소속 문맥이 사라져 의미를 잘못 이해할 수 있습니다.'],
            ['추출 오류와 반복 문구가 남으면', '실제 내용 대신 머릿글·깨진 표·잘못 인식된 문장이 검색될 수 있습니다.'],
          ].map(([title, description]) => (
            <div key={title} className="flex flex-col gap-1 border-b p-4 last:border-b-0">
              <p className="font-semibold">{title}</p>
              <p className="text-sm leading-6 text-muted-foreground">{description}</p>
            </div>
          ))}
        </div>

        <p className="rounded-lg bg-primary/10 px-4 py-3 text-sm font-medium leading-6">
          따라서 텍스트 추출 확인과 결과 검토 단계에서 누락, 제목, 표, 내용 단위가 자연스럽게 나뉘었는지 반드시 확인해야 합니다.
        </p>
      </CardContent>
    </Card>
  );
}

function HandlingGuide() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>어떤 방법으로 문서를 처리하면 되나요?</CardTitle>
        <CardDescription className="leading-6">
          대부분의 일반 문서는 이 전처리기만으로 충분합니다. 1번부터 시작하고, 처리하기 어려울 때만 다음 방법으로 넘어가세요.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ol className="grid gap-3 lg:grid-cols-3">
          {DOCUMENT_HANDLING_STAGES.map((stage) => (
            <li
              key={stage.id}
              className={
                stage.id === 'assisted-processing'
                  ? 'rounded-lg border border-amber-300 bg-amber-50/50 p-4 dark:bg-amber-950/15'
                  : 'rounded-lg border p-4'
              }
            >
              <div className="mb-3 flex items-center gap-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                  {stage.step}
                </span>
                <p className="font-semibold leading-6">{stage.title}</p>
              </div>
              <p className="text-sm leading-6 text-muted-foreground">{stage.description}</p>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-6 text-muted-foreground">
                {stage.examples.map((example) => (
                  <li key={example}>{example}</li>
                ))}
              </ul>
            </li>
          ))}
        </ol>

        <section className="rounded-lg border bg-muted/30 p-4">
          <h3 className="font-semibold">표가 있는 문서는 이렇게 확인하세요</h3>
          <div className="mt-3 grid gap-3 lg:grid-cols-3">
            {TABLE_HANDLING_GUIDANCE.map((item) => (
              <div key={item.title} className="rounded-md bg-background p-3">
                <p className="text-sm font-medium">{item.title}</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </section>

        <div className="rounded-lg bg-primary/10 px-4 py-3 text-sm leading-6">
          <p className="font-semibold">기억하세요</p>
          <p className="mt-1 text-muted-foreground">{DOCUMENT_HANDLING_SECURITY_NOTICE}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function FileRoutingGuide() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>파일이 처리되는 위치</CardTitle>
        <CardDescription>
          선택한 파일 하나만 처리합니다. 모든 파일 형식이 MISO로 전송되는 것은 아닙니다.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="bg-muted/60">
              <tr>
                <th className="px-4 py-3 font-semibold">구분</th>
                <th className="px-4 py-3 font-semibold">지원 형식</th>
                <th className="px-4 py-3 font-semibold">텍스트 추출</th>
                <th className="px-4 py-3 font-semibold">MISO 전송</th>
              </tr>
            </thead>
            <tbody>
              {fileRoutes.map((item) => (
                <tr key={item.category} className="border-t align-top">
                  <td className="px-4 py-3 font-medium">{item.category}</td>
                  <td className="px-4 py-3"><ExtensionList extensions={item.extensions} /></td>
                  <td className="px-4 py-3 text-muted-foreground">{item.disclosure.extractionLabel}</td>
                  <td className="px-4 py-3">
                    <Badge variant={item.disclosure.transmission === 'never' ? 'outline' : 'default'}>
                      {item.disclosure.transmissionLabel}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          추출된 텍스트는 이 웹앱의 전처리 API에서 정리됩니다. 최종 TXT는 사용자가 직접 내려받아 등록합니다.
        </p>
      </CardContent>
    </Card>
  );
}

function SupportScopeGuide() {
  return (
    <Alert>
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>파일 지원 범위와 확인할 점</AlertTitle>
      <AlertDescription>
        <ul className="mt-2 list-disc space-y-1 pl-5 leading-6">
          <li>파일당 최대 용량은 {maxFileSizeMb}MB입니다. 큰 엑셀은 브라우저 메모리에 따라 처리가 느리거나 실패할 수 있습니다.</li>
          <li>{EXCEL_PREPROCESS_HELP_GUIDANCE}</li>
          <li>
            엑셀은 탭(시트)이 많거나 서로 다른 업무·기간·부서의 내용이 섞여 있으면 주제별 파일로 나눠 처리하는 것을 권장합니다.
            고정된 탭 개수 제한은 없지만, 관련된 시트는 함께 두고 관계없는 시트 묶음만 나누세요.
          </li>
          <li>HWP는 직접 지원하지 않습니다. DOCX 또는 PDF로 변환한 뒤 업로드하세요.</li>
          <li>암호가 걸렸거나 손상된 파일, 복잡한 표, 스캔 품질이 낮은 이미지에서는 누락이나 OCR 오인식이 생길 수 있습니다.</li>
        </ul>
      </AlertDescription>
    </Alert>
  );
}

function ToolPurposeGuide() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>이 도구가 하는 일</CardTitle>
        <CardDescription>
          여러 형태의 사내 문서를 MISO RAG에 등록하기 쉬운 청크 구분 TXT로 만듭니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border bg-primary/5 p-4">
          <div className="mb-2 flex items-center gap-2 font-semibold">
            <FileText className="h-4 w-4 text-primary" />
            이 페이지에서 처리
          </div>
          <p className="text-sm leading-6 text-muted-foreground">
            텍스트 추출, 반복 머릿글 정리, 문서 종류별 청크 분할, @@@ 구분자 삽입,
            결과 검토와 TXT 다운로드를 수행합니다.
          </p>
        </div>
        <div className="rounded-lg border p-4">
          <div className="mb-2 flex items-center gap-2 font-semibold">
            <Database className="h-4 w-4 text-primary" />
            MISO RAG에서 처리
          </div>
          <p className="text-sm leading-6 text-muted-foreground">
            다운로드한 TXT의 실제 등록, 임베딩, 벡터 생성과 검색은 MISO RAG에서 진행합니다.
            이 페이지가 결과 파일을 RAG에 자동 등록하지는 않습니다.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function UsageStepsGuide() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>사용 순서</CardTitle>
        <CardDescription>화면의 1~4단계를 따라가고 마지막에 TXT를 내려받으세요.</CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {steps.map((step, index) => {
            const Icon = step.icon;
            return (
              <li key={step.title} className="rounded-lg border p-4">
                <div className="mb-3 flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                    {index + 1}
                  </span>
                  <Icon className="h-4 w-4 text-primary" />
                </div>
                <p className="font-semibold">{step.title}</p>
                <p className="mt-1 text-sm leading-5 text-muted-foreground">{step.description}</p>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}

function DocumentRulesGuide() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>문서 종류별 정리 기준</CardTitle>
        <CardDescription>
          먼저 공통 기준을 확인한 뒤, 내용의 주된 구조와 가장 가까운 유형 하나를 선택하세요.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <section className="rounded-lg border bg-muted/30 p-4">
          <h3 className="font-semibold">모든 문서에 공통으로 적용</h3>
          <ul className="mt-3 grid gap-2 md:grid-cols-2">
            {commonDocumentRules.map((rule) => (
              <li key={rule} className="flex gap-2 text-sm leading-6">
                <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-primary" />
                <span>{rule}</span>
              </li>
            ))}
          </ul>
        </section>

        <div className="grid gap-3 md:grid-cols-2">
          {documentTypes.map((type) => (
            <section key={type.name} className="rounded-lg border p-4">
              <h3 className="font-semibold">{type.name}</h3>
              <p className="mt-3 text-xs font-medium text-foreground">이런 문서에 선택</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">{type.selection}</p>
              <p className="mt-3 text-xs font-medium text-foreground">정리 방식</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">{type.rules}</p>
            </section>
          ))}
        </div>

        <p className="rounded-lg bg-primary/10 px-4 py-3 text-sm leading-6">
          <strong>[위임전결규정 매뉴얼]</strong>과 A~J 항목 구조가 확인되면 엑셀·내부 데이터 외 유형에서 전용 기준을 우선 적용합니다.
        </p>
      </CardContent>
    </Card>
  );
}

function ReviewCautionsGuide() {
  return (
    <Alert>
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>결과 확인 시 주의사항</AlertTitle>
      <AlertDescription>
        <ul className="mt-2 list-disc space-y-1 pl-5 leading-6">
          <li>4,000자는 토큰 수가 아니라 문자 수 기준입니다. MISO RAG의 실제 제한과 검색 품질은 등록 후 별도로 확인하세요.</li>
          <li>다운로드 전에 텍스트 추출 확인과 결과 검토 화면에서 제목, 표, 숫자, 개인정보를 원문과 대조하세요.</li>
        </ul>
      </AlertDescription>
    </Alert>
  );
}

function GuideSection({ sectionId }: { sectionId: HelpSectionId }) {
  switch (sectionId) {
    case 'necessity':
      return <NecessityGuide />;
    case 'handling-guide':
      return <HandlingGuide />;
    case 'file-routing':
      return <FileRoutingGuide />;
    case 'support-scope':
      return <SupportScopeGuide />;
    case 'tool-purpose':
      return <ToolPurposeGuide />;
    case 'steps':
      return <UsageStepsGuide />;
    case 'document-rules':
      return <DocumentRulesGuide />;
    case 'review-cautions':
      return <ReviewCautionsGuide />;
  }
}

export function UsageGuide() {
  return (
    <section aria-label="문서 전처리 도움말">
      <Tabs defaultValue="understanding">
        <TabsList
          aria-label="도움말 목차"
          className="h-auto w-full justify-start gap-6 overflow-x-auto rounded-none border-b bg-transparent p-0"
        >
          {HELP_TABS.map((tab) => (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              className="h-auto flex-none rounded-none border-x-0 border-t-0 border-b-2 border-transparent bg-transparent px-1 pt-1 pb-3 text-muted-foreground shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none dark:data-[state=active]:bg-transparent"
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {HELP_TABS.map((tab) => (
          <TabsContent key={tab.id} value={tab.id} className="mt-4 space-y-6">
            {tab.sectionIds.map((sectionId) => (
              <GuideSection key={sectionId} sectionId={sectionId} />
            ))}
          </TabsContent>
        ))}
      </Tabs>
    </section>
  );
}
