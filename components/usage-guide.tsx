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
import {
  LOCAL_EXCEL_EXTENSIONS,
  LOCAL_TEXT_EXTENSIONS,
  MAX_FILE_SIZE_BYTES,
  MISO_DOCUMENT_EXTENSIONS,
  MISO_IMAGE_EXTENSIONS,
} from '@/lib/file-processing-policy';

const maxFileSizeMb = MAX_FILE_SIZE_BYTES / 1024 / 1024;

const steps = [
  {
    icon: Upload,
    title: '파일 업로드',
    description: '한 번에 파일 하나를 선택해 텍스트를 추출합니다.',
  },
  {
    icon: ScanText,
    title: '텍스트 확인',
    description: '누락·깨짐·불필요한 문구가 없는지 원문과 비교합니다.',
  },
  {
    icon: Settings2,
    title: '전처리 설정',
    description: '문서 종류를 선택하고 청크 구분자(기본 @@@)를 정합니다.',
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

const documentTypes = [
  {
    name: '법령·사규',
    description: '편·장·절·관·조문 구조를 인식해 조문 단위 문맥을 보존합니다.',
  },
  {
    name: '표·엑셀 데이터',
    description: '시트명과 열 제목을 보존하고 표의 행이 가능한 한 함께 있도록 나눕니다.',
  },
  {
    name: '설명서·업무 매뉴얼',
    description: '번호 제목과 작업 절차가 중간에서 끊기지 않도록 구조 중심으로 나눕니다.',
  },
  {
    name: '일반 문서·보고서',
    description: '문단·표·조문형 제목을 함께 고려하는 범용 방식으로 정리합니다.',
  },
];

const fileRoutes = [
  {
    category: '텍스트·데이터',
    extensions: LOCAL_TEXT_EXTENSIONS,
    route: '브라우저에서 바로 읽음',
    sentToMiso: false,
  },
  {
    category: '엑셀',
    extensions: LOCAL_EXCEL_EXTENSIONS,
    route: '브라우저에서 변환',
    sentToMiso: false,
  },
  {
    category: '문서',
    extensions: MISO_DOCUMENT_EXTENSIONS,
    route: 'MISO로 텍스트 추출',
    sentToMiso: true,
  },
  {
    category: '이미지',
    extensions: MISO_IMAGE_EXTENSIONS,
    route: 'MISO로 텍스트 추출',
    sentToMiso: true,
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

export function UsageGuide() {
  return (
    <section className="space-y-6" aria-labelledby="usage-guide-title">
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
            따라서 텍스트 확인과 결과 검토 단계에서 누락, 제목, 표, 내용 단위가 자연스럽게 나뉘었는지 반드시 확인해야 합니다.
          </p>
        </CardContent>
      </Card>

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

      <Card>
        <CardHeader>
          <CardTitle>문서 종류 선택 기준</CardTitle>
          <CardDescription>내용의 주된 구조와 가장 가까운 유형 하나를 선택하세요.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {documentTypes.map((type) => (
            <div key={type.name} className="rounded-lg border p-4">
              <p className="font-semibold">{type.name}</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">{type.description}</p>
            </div>
          ))}
        </CardContent>
      </Card>

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
                    <td className="px-4 py-3 text-muted-foreground">{item.route}</td>
                    <td className="px-4 py-3">
                      <Badge variant={item.sentToMiso ? 'default' : 'outline'}>
                        {item.sentToMiso ? '전송함' : '전송 안 함'}
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

      <Card>
        <CardHeader>
          <CardTitle>자동 정리 기준</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-3 md:grid-cols-2">
            {[
              '페이지 번호는 원문 확인을 위해 그대로 둡니다.',
              '여러 페이지에서 반복되는 짧은 머릿글은 첫 번째만 남깁니다.',
              '4,000자 이내의 조문은 가능한 한 하나의 청크로 유지합니다.',
              '4,000자를 넘는 조문은 분할하고 각 청크에 같은 조문 제목을 붙입니다.',
              '분할 제목에 “(계속)” 같은 임의 문구를 추가하지 않습니다.',
              '표와 반복된 업무 문장은 머릿글로 단정하지 않고 최대한 보존합니다.',
            ].map((rule) => (
              <li key={rule} className="flex gap-2 rounded-lg border p-3 text-sm leading-6">
                <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-primary" />
                <span>{rule}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>지원 범위와 확인할 점</AlertTitle>
        <AlertDescription>
          <ul className="mt-2 list-disc space-y-1 pl-5 leading-6">
            <li>파일당 최대 용량은 {maxFileSizeMb}MB입니다. 큰 엑셀은 브라우저 메모리에 따라 처리가 느리거나 실패할 수 있습니다.</li>
            <li>
              엑셀은 탭(시트)이 많거나 서로 다른 업무·기간·부서의 내용이 섞여 있으면 주제별 파일로 나눠 처리하는 것을 권장합니다.
              고정된 탭 개수 제한은 없지만, 관련된 시트는 함께 두고 관계없는 시트 묶음만 나누세요.
            </li>
            <li>HWP는 직접 지원하지 않습니다. DOCX 또는 PDF로 변환한 뒤 업로드하세요.</li>
            <li>암호가 걸렸거나 손상된 파일, 복잡한 표, 스캔 품질이 낮은 이미지에서는 누락이나 OCR 오인식이 생길 수 있습니다.</li>
            <li>4,000자는 토큰 수가 아니라 문자 수 기준입니다. MISO RAG의 실제 제한과 검색 품질은 등록 후 별도로 확인하세요.</li>
            <li>다운로드 전에 텍스트 확인과 결과 검토 화면에서 제목, 표, 숫자, 개인정보를 원문과 대조하세요.</li>
          </ul>
        </AlertDescription>
      </Alert>
    </section>
  );
}
