'use client';

import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AlertCircle,
  Loader2,
} from 'lucide-react';
import {
  RadioGroup,
  RadioGroupItem,
} from '@/components/ui/radio-group';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';

import type { DocType } from '@/lib/text-preprocessor';

import { ChunkViewerModal } from '@/components/chunk-viewer-modal';
import { ChunkFlowViewer } from '@/components/chunk-flow-viewer';
import { Switch } from '@/components/ui/switch';
import { ProgressStepper } from '@/components/progress-stepper';
import { UsageGuide } from '@/components/usage-guide';

import { useFileProcessor } from '@/hooks/useFileProcessor';
import { FILE_INPUT_ACCEPT } from '@/lib/file-processing-policy';

// ReactMarkdown 플러그인: 모든 요소에 data-source-pos 속성을 주입하여 원본 위치 추적
const addSourcePosPlugin = () => {
  return (tree: any) => {
    const visit = (node: any) => {
      if (node.position && node.position.start && node.type !== 'root') {
        if (!node.data) node.data = {};
        if (!node.data.hProperties) node.data.hProperties = {};
        node.data.hProperties['data-source-pos'] = node.position.start.offset;
      }
      if (node.children) {
        node.children.forEach(visit);
      }
    };
    visit(tree);
  };
};

// Textarea 미러링을 위한 스타일 속성 목록
const MIRROR_STYLES = [
  'borderBottomWidth',
  'borderLeftWidth',
  'borderRightWidth',
  'borderTopWidth',
  'boxSizing',
  'fontFamily',
  'fontSize',
  'fontStyle',
  'fontWeight',
  'letterSpacing',
  'lineHeight',
  'paddingBottom',
  'paddingLeft',
  'paddingRight',
  'paddingTop',
  'tabSize',
  'textIndent',
  'textTransform',
  'width',
  'wordBreak',
  'wordSpacing',
  'wordWrap',
];

export default function Home() {
  const {
    file,
    inputText,
    processedText,
    processedChunks,
    docType,
    separator,
    stats,
    error,
    status,
    // Actions
    setFile,
    setInputText,
    setDocType,
    setSeparator,
    setProcessedText,
    updateChunks,
    reset,
    handleFileRead,
    processText,
  } = useFileProcessor();

  const [inputKey, setInputKey] = useState(Date.now());
  const [isChunkModalOpen, setIsChunkModalOpen] = useState(false);
  const [showChunkFlow, setShowChunkFlow] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [activeTab, setActiveTab] = useState<string>('upload');
  const [isVisualizationReady, setIsVisualizationReady] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingText, setEditingText] = useState('');
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
  const [headerTab, setHeaderTab] = useState<'preprocess' | 'guide'>('preprocess');
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const scrollPosRef = useRef<number>(0);
  
  // 상태 변경 감지를 위한 ref
  const prevStatusRef = useRef(status);
  const prevErrorRef = useRef(error);

  // 에러 발생 시 Toast 알림
  useEffect(() => {
    if (error && error !== prevErrorRef.current) {
      toast.error('오류 발생', {
        description: error,
        duration: 5000,
      });
      prevErrorRef.current = error;
    }
  }, [error]);

  // Preview 모드로 전환될 때 스크롤 위치 복원
  useEffect(() => {
    if (showPreview && previewRef.current && scrollPosRef.current >= 0) {
      requestAnimationFrame(() => {
        if (previewRef.current) {
          const { scrollHeight, clientHeight } = previewRef.current;
          const targetScrollTop = scrollPosRef.current * (scrollHeight - clientHeight);
          previewRef.current.scrollTop = targetScrollTop;
        }
      });
    }
  }, [showPreview]);

  // 편집 완료 핸들러
  const handleEditComplete = () => {
    if (textareaRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = textareaRef.current;
      const maxScroll = scrollHeight - clientHeight;
      if (maxScroll > 0) {
        scrollPosRef.current = scrollTop / maxScroll;
      } else {
        scrollPosRef.current = 0;
      }
    }
    setShowPreview(true);
  };

  // 파일 로드 완료 시 자동으로 다음 단계로 이동
  useEffect(() => {
    const prevStatus = prevStatusRef.current;
    prevStatusRef.current = status;

    if ((prevStatus === 'reading' || prevStatus === 'uploading') && status === 'idle' && inputText) {
      setActiveTab('input');
      // 미리보기는 기본적으로 비활성화 (사용자가 원할 때 활성화)
      setShowPreview(false);
      toast.success('텍스트 추출 완료', {
        description: `${inputText.length.toLocaleString()}자가 추출되었습니다.`,
      });
    }

    if (prevStatus === 'processing' && status === 'complete') {
      setActiveTab('output');
      setIsVisualizationReady(true);
      setShowChunkFlow(true); // 시각화 자동 활성화
      setIsEditMode(false); // 편집 모드 비활성화
      toast.success('전처리 완료', {
        description: `${stats?.chunkCount}개의 청크가 생성되었습니다.`,
      });
    }
  }, [status, inputText, stats]);

  // 결과 검토 탭 진입 시 시각화 자동 활성화
  useEffect(() => {
    if (activeTab === 'output' && processedText && !isEditMode) {
      setShowChunkFlow(true);
      setIsVisualizationReady(true);
    }
  }, [activeTab, processedText, isEditMode]);

  // 편집 모드로 전환될 때 텍스트 위치 찾아가기
  const jumpToTextPosition = (targetText: string, offset?: number) => {
    if (!textareaRef.current || !inputText) return;
    
    let index = -1;

    if (typeof offset === 'number' && offset >= 0) {
      index = offset;
    } else {
      const searchKeyword = targetText.slice(0, 30).trim(); 
      if (!searchKeyword) return;
      index = inputText.indexOf(searchKeyword);
    }
    
    if (index !== -1) {
      const textarea = textareaRef.current;
      textarea.focus();
      textarea.setSelectionRange(index, index);

      const div = document.createElement('div');
      const styles = window.getComputedStyle(textarea);
      
      MIRROR_STYLES.forEach((key) => {
        // @ts-ignore
        div.style[key] = styles[key];
      });

      div.style.height = 'auto';
      div.style.minHeight = '0';
      div.style.maxHeight = 'none';
      div.style.overflow = 'hidden';
      div.style.position = 'absolute';
      div.style.top = '-9999px';
      div.style.left = '-9999px';
      div.style.visibility = 'hidden';
      div.style.whiteSpace = 'pre-wrap';

      const textContent = inputText.substring(0, index);
      div.textContent = textContent;
      
      const span = document.createElement('span');
      span.textContent = '|';
      div.appendChild(span);

      document.body.appendChild(div);
      
      const targetTop = span.offsetTop;
      const computedLineHeight = parseInt(styles.lineHeight);
      const lineHeight = isNaN(computedLineHeight) ? 20 : computedLineHeight;
      
      document.body.removeChild(div);

      textarea.scrollTop = Math.max(0, targetTop - (textarea.clientHeight / 2) + (lineHeight / 2));
    }
  };

  const handleResetClick = () => {
    // 데이터가 있으면 확인 다이얼로그 표시
    if (inputText || processedText) {
      setIsResetDialogOpen(true);
    } else {
      // 데이터가 없으면 바로 초기화
      performReset();
    }
  };

  const performReset = () => {
    reset();
    setInputKey(Date.now());
    setActiveTab('upload');
    setShowPreview(false);
    setShowChunkFlow(false);
    setIsVisualizationReady(false);
    setIsEditMode(false);
    setEditingText('');
    setIsResetDialogOpen(false);
    toast.info('초기화 완료', {
      description: '모든 데이터가 초기화되었습니다.',
    });
  };

  const handleDownload = () => {
    if (!processedText) return;

    const blob = new Blob([processedText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    
    let fileName = `preprocessed_data_${new Date().getTime()}.txt`;
    if (file) {
      const originalName = file.name.replace(/\.[^/.]+$/, "");
      fileName = `[전처리] ${originalName}.txt`;
    }

    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast.success('다운로드 완료', {
      description: fileName,
    });
  };

  // 단계 상태 계산
  const steps = [
    {
      id: 'upload',
      label: '파일 업로드',
      status: file 
        ? 'completed' as const
        : activeTab === 'upload' 
        ? 'current' as const 
        : 'pending' as const,
    },
    {
      id: 'input',
      label: '텍스트 확인',
      status: inputText 
        ? processedText 
          ? 'completed' as const 
          : activeTab === 'input' 
          ? 'current' as const 
          : 'completed' as const
        : 'pending' as const,
    },
    {
      id: 'process',
      label: '전처리',
      status: processedText 
        ? 'completed' as const 
        : inputText && activeTab === 'process' 
        ? 'current' as const 
        : 'pending' as const,
    },
    {
      id: 'output',
      label: '결과 검토',
      status: processedText 
        ? activeTab === 'output' 
          ? 'current' as const 
          : 'completed' as const
        : 'pending' as const,
    },
  ];

  return (
    <main className="min-h-screen bg-gradient-to-br from-background via-background to-muted/10 py-8 px-4">
      <div className="container max-w-7xl mx-auto">
        {/* 헤더 */}
        <div className="mb-8">
          <div className="mb-6">
            <h1 className="text-3xl font-bold tracking-tight">
              문서전처리(MISO RAG 투입용 TXT 제작 도구)
            </h1>
            <p className="text-muted-foreground mt-1">
              사내 문서를 MISO RAG에 바로 등록할 수 있는 TXT 파일로 정리합니다.
            </p>

            <div
              role="tablist"
              aria-label="화면 선택"
              className="mt-5 inline-flex rounded-lg border bg-muted/40 p-1"
            >
              <Button
                type="button"
                role="tab"
                aria-selected={headerTab === 'preprocess'}
                variant={headerTab === 'preprocess' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setHeaderTab('preprocess')}
              >
                전처리
              </Button>
              <Button
                type="button"
                role="tab"
                aria-selected={headerTab === 'guide'}
                variant={headerTab === 'guide' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setHeaderTab('guide')}
              >
                사용법
              </Button>
            </div>
          </div>

          {/* 진행 단계 표시 */}
          {headerTab === 'preprocess' && <ProgressStepper steps={steps} />}
        </div>

        {headerTab === 'guide' && <UsageGuide />}

        {/* 에러 알림 */}
        {headerTab === 'preprocess' && error && (
          <Alert variant="destructive" className="mb-6">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="whitespace-pre-wrap">{error}</AlertDescription>
          </Alert>
        )}

        {/* 메인 컨텐츠 */}
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className={headerTab === 'preprocess' ? 'w-full' : 'hidden'}
        >
          <TabsList className="grid w-full grid-cols-4 h-auto p-1">
            <TabsTrigger value="upload" className="py-2.5">
              1. 파일 업로드
            </TabsTrigger>
            <TabsTrigger value="input" disabled={!inputText} className="py-2.5">
              2. 텍스트 확인
            </TabsTrigger>
            <TabsTrigger value="process" disabled={!inputText} className="py-2.5">
              3. 전처리
            </TabsTrigger>
            <TabsTrigger value="output" disabled={!processedText} className="py-2.5">
              4. 결과 검토
            </TabsTrigger>
          </TabsList>

          {/* 탭 1: 파일 업로드 */}
          <TabsContent value="upload" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle>파일 선택</CardTitle>
                <CardDescription>
                  문서 또는 이미지 파일을 업로드하면 텍스트로 변환합니다
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-3">
                  <Input
                    key={inputKey}
                    id="file"
                    type="file"
                    accept={FILE_INPUT_ACCEPT}
                    onChange={(e) => {
                      const selectedFile = e.target.files?.[0];
                      if (selectedFile) {
                        setFile(selectedFile);
                      }
                    }}
                    className="cursor-pointer"
                  />
                  {file && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/30 px-4 py-3 rounded-md">
                      <div className="flex-1 flex items-center gap-2">
                        <p className="font-medium text-foreground">{file.name}</p>
                        <p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(2)} KB</p>
                      </div>
                    </div>
                  )}
                </div>

                <Button 
                  onClick={() => file && handleFileRead(file)} 
                  disabled={status === 'reading' || status === 'uploading' || !file}
                  className="w-full h-12 text-base font-semibold"
                  size="lg"
                >
                  {status === 'reading' || status === 'uploading' ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      파일 처리 중...
                    </>
                  ) : (
                    '파일 처리하기'
                  )}
                </Button>

                {(status === 'reading' || status === 'uploading') && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">
                        {status === 'reading' ? '텍스트 추출 중' : 'API 처리 중'}
                      </span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                      <div className="h-full bg-primary animate-pulse" style={{ width: '100%' }} />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* 탭 2: 텍스트 확인 및 편집 */}
          <TabsContent value="input" className="mt-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>전처리 전 텍스트</CardTitle>
                    <CardDescription className="mt-1.5">
                      추출된 텍스트를 확인하고 필요시 수정하세요
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-3">
                    <Button
                      onClick={handleResetClick}
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-foreground"
                    >
                      초기화
                    </Button>
                    <Label htmlFor="input-preview-mode" className="text-sm font-medium cursor-pointer">
                      마크다운
                    </Label>
                    <Switch 
                      id="input-preview-mode"
                      checked={showPreview}
                      onCheckedChange={setShowPreview}
                      disabled={!inputText}
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {showPreview && inputText ? (
                  <div 
                    ref={previewRef}
                    className="min-h-[600px] max-h-[600px] rounded-md border bg-muted/5 px-6 py-4 text-sm overflow-y-auto cursor-text group relative hover:border-muted-foreground/20 transition-colors"
                    onClick={(e) => {
                      const target = e.target as HTMLElement;
                      const posElement = target.closest('[data-source-pos]') as HTMLElement;
                      const offsetStr = posElement?.getAttribute('data-source-pos');
                      let offset = offsetStr ? parseInt(offsetStr, 10) : undefined;

                      if (offset !== undefined && posElement) {
                        if (document.caretRangeFromPoint) {
                          const range = document.caretRangeFromPoint(e.clientX, e.clientY);
                          if (range && posElement.contains(range.startContainer)) {
                             const preCaretRange = range.cloneRange();
                             preCaretRange.selectNodeContents(posElement);
                             preCaretRange.setEnd(range.startContainer, range.startOffset);
                             offset += preCaretRange.toString().length;
                          }
                        } 
                        else if ((document as any).caretPositionFromPoint) {
                           const pos = (document as any).caretPositionFromPoint(e.clientX, e.clientY);
                           if (pos && posElement.contains(pos.offsetNode)) {
                               const range = document.createRange();
                               range.selectNodeContents(posElement);
                               range.setEnd(pos.offsetNode, pos.offset);
                               offset += range.toString().length;
                           }
                        }
                      }

                      let targetText = '';
                      if (target.innerText) {
                        targetText = target.innerText;
                      }
                      
                      setShowPreview(false);
                      setTimeout(() => {
                          jumpToTextPosition(targetText, offset);
                      }, 0);
                    }}
                    title="클릭하여 편집하기"
                  >
                      <div className="absolute top-3 right-3 flex gap-2">
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-primary text-primary-foreground text-xs px-3 py-1.5 rounded-md pointer-events-none font-medium shadow-lg">
                        클릭하여 편집
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowPreview(false);
                        }}
                        className="opacity-100"
                      >
                        편집 모드
                      </Button>
                    </div>
                      <ReactMarkdown 
                        remarkPlugins={[remarkGfm, addSourcePosPlugin]}
                        components={{
                          h1: ({...props}: any) => <h1 className="text-2xl font-bold mt-6 mb-4 scroll-m-20 border-b pb-2" {...props} />,
                          h2: ({...props}: any) => <h2 className="text-xl font-semibold mt-6 mb-3 scroll-m-20 border-b pb-2 first:mt-0" {...props} />,
                          h3: ({...props}: any) => <h3 className="text-lg font-semibold mt-4 mb-2 scroll-m-20" {...props} />,
                          h4: ({...props}: any) => <h4 className="text-base font-semibold mt-3 mb-2 scroll-m-20" {...props} />,
                          p: ({...props}: any) => <p className="leading-7 [&:not(:first-child)]:mt-4" {...props} />,
                          ul: ({...props}: any) => <ul className="my-4 ml-6 list-disc [&>li]:mt-2" {...props} />,
                          ol: ({...props}) => <ol className="my-4 ml-6 list-decimal [&>li]:mt-2" {...props} />,
                          li: ({...props}) => <li className="" {...props} />,
                          blockquote: ({...props}: any) => <blockquote className="mt-6 border-l-2 pl-6 italic text-muted-foreground" {...props} />,
                          img: ({...props}: any) => <img className="rounded-md border my-4 max-w-full" {...props} alt={props.alt || ''} />,
                          hr: ({...props}: any) => <hr className="my-4 border-muted" {...props} />,
                          table: ({...props}: any) => <div className="my-6 w-full overflow-y-auto"><table className="w-full border-collapse text-sm" {...props} /></div>,
                          tr: ({...props}: any) => <tr className="m-0 border-t p-0 even:bg-muted/50" {...props} />,
                          th: ({...props}: any) => <th className="border px-4 py-2 text-left font-bold [&[align=center]]:text-center [&[align=right]]:text-right bg-muted" {...props} />,
                          td: ({...props}: any) => <td className="border px-4 py-2 text-left [&[align=center]]:text-center [&[align=right]]:text-right" {...props} />,
                          code({inline, className, children, ...props}: any) {
                            return !inline ? (
                              <pre className="mb-4 mt-4 overflow-x-auto rounded-lg border bg-muted px-4 py-4 font-mono text-xs" {...props}>
                                <code className={className}>
                                  {children}
                                </code>
                              </pre>
                            ) : (
                              <code className={`relative rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-sm font-semibold ${className || ''}`} {...props}>
                                {children}
                              </code>
                            )
                          }
                        }}
                      >
                        {inputText}
                      </ReactMarkdown>
                  </div>
                ) : (
                  <Textarea
                    ref={textareaRef}
                    placeholder="추출된 텍스트가 여기에 표시됩니다..."
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    className="min-h-[600px] font-mono text-sm resize-none"
                  />
                )}

                <div className="flex items-center justify-between pt-2 text-sm text-muted-foreground">
                  <span>입력 길이: {inputText.length.toLocaleString()}자</span>
                  <Button 
                    onClick={() => setActiveTab('process')}
                    disabled={!inputText.trim()}
                  >
                    다음 단계: 전처리
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* 탭 3: 전처리 설정 */}
          <TabsContent value="process" className="mt-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>전처리 설정</CardTitle>
                    <CardDescription className="mt-1.5">
                      문서 종류와 청크 구분자를 설정하고 전처리를 시작하세요
                    </CardDescription>
                  </div>
                  <Button
                    onClick={handleResetClick}
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-foreground"
                  >
                    초기화
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-4">
                  <Label className="text-base font-medium">문서 종류</Label>
                  <RadioGroup
                    value={docType}
                    onValueChange={(value) => setDocType(value as DocType)}
                    className="grid grid-cols-2 gap-4"
                  >
                    <div className="flex items-start space-x-3 border rounded-lg px-4 py-3 hover:bg-muted/50 transition-colors cursor-pointer has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                      <RadioGroupItem id="doc-law" value="law" className="mt-1" />
                      <Label htmlFor="doc-law" className="flex-1 cursor-pointer font-normal">
                        <span className="block font-medium">법령·사규</span>
                        <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                          편·장·절·관·조와 부칙 구조를 우선 보존합니다
                        </span>
                      </Label>
                    </div>
                    <div className="flex items-start space-x-3 border rounded-lg px-4 py-3 hover:bg-muted/50 transition-colors cursor-pointer has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                      <RadioGroupItem id="doc-excel" value="excel" className="mt-1" />
                      <Label htmlFor="doc-excel" className="flex-1 cursor-pointer font-normal">
                        <span className="block font-medium">엑셀·내부 데이터</span>
                        <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                          시트명과 열 제목을 유지하며 행 단위로 나눕니다
                        </span>
                      </Label>
                    </div>
                    <div className="flex items-start space-x-3 border rounded-lg px-4 py-3 hover:bg-muted/50 transition-colors cursor-pointer has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                      <RadioGroupItem id="doc-manual" value="manual" className="mt-1" />
                      <Label htmlFor="doc-manual" className="flex-1 cursor-pointer font-normal">
                        <span className="block font-medium">설명서·업무 매뉴얼</span>
                        <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                          소제목과 작업 절차가 중간에서 끊기지 않게 나눕니다
                        </span>
                      </Label>
                    </div>
                    <div className="flex items-start space-x-3 border rounded-lg px-4 py-3 hover:bg-muted/50 transition-colors cursor-pointer has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                      <RadioGroupItem id="doc-general" value="general" className="mt-1" />
                      <Label htmlFor="doc-general" className="flex-1 cursor-pointer font-normal">
                        <span className="block font-medium">일반 문서·보고서</span>
                        <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                          문단과 표 구조를 기준으로 자연스럽게 나눕니다
                        </span>
                      </Label>
                    </div>
                  </RadioGroup>
                </div>

                <div className="space-y-3">
                  <Label htmlFor="separator" className="text-base font-medium">
                    청크 구분자
                  </Label>
                  <Input
                    id="separator"
                    value={separator}
                    onChange={(e) => setSeparator(e.target.value)}
                    placeholder="예: @@@"
                    className="font-mono"
                  />
                  <p className="text-sm text-muted-foreground">
                    RAG 시스템에서 청크를 구분하는 문자열입니다. 기본값: @@@
                  </p>
                </div>

                <Button 
                  onClick={processText} 
                  disabled={status === 'processing' || !inputText.trim()}
                  className="w-full h-12 text-base font-semibold"
                  size="lg"
                >
                  {status === 'processing' ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      처리 중...
                    </>
                  ) : (
                    '전처리 시작'
                  )}
                </Button>

                {status === 'processing' && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">전처리 진행 중</span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                      <div className="h-full bg-primary animate-pulse" style={{ width: '100%' }} />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* 탭 4: 결과 검토 */}
          <TabsContent value="output" className="mt-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>전처리 결과</CardTitle>
                    <CardDescription className="mt-1.5">
                      {isEditMode 
                        ? '텍스트를 수정하고 저장 버튼을 클릭하세요' 
                        : '시각화로 결과를 확인하고, 필요시 수정하세요'}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-3">
                    <Button
                      onClick={handleResetClick}
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-foreground"
                    >
                      초기화
                    </Button>
                    {!isEditMode ? (
                      <>
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setIsEditMode(true);
                            setEditingText(processedText);
                            setShowChunkFlow(false);
                          }}
                          disabled={!processedText}
                        >
                          수정하기
                        </Button>
                        <Button  
                          variant="outline"
                          onClick={() => setIsChunkModalOpen(true)}
                          disabled={!processedChunks.length}
                        >
                          청크별 보기
                        </Button>
                      </>
                    ) : (
                      <Button
                        onClick={() => {
                          // 텍스트 편집 후 저장 시 청크 데이터도 함께 업데이트
                          // 구분자를 기준으로 나누되, 구분자 주변의 공백(줄바꿈 포함)을 제거하여 깔끔한 청크 생성
                          const escapedSeparator = separator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                          const newChunks = editingText.split(new RegExp(`\\s*${escapedSeparator}\\s*`));
                          
                          updateChunks(newChunks); // 이 함수가 processedText도 함께 업데이트함 (join으로)
                          
                          setIsEditMode(false);
                          setShowChunkFlow(true);
                          toast.success('저장 완료', {
                            description: '수정 내용이 저장되고 청크가 재구성되었습니다.',
                          });
                        }}
                        disabled={!editingText.trim()}
                      >
                        저장하기
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {!isEditMode && showChunkFlow && isVisualizationReady ? (
                  <div className="h-[600px] rounded-lg border overflow-hidden">
                    <ChunkFlowViewer chunks={processedChunks} onChunkUpdate={updateChunks} />
                  </div>
                ) : (
                  <Textarea
                    placeholder="전처리된 결과가 여기에 표시됩니다..."
                    value={isEditMode ? editingText : processedText}
                    onChange={(e) => {
                      if (isEditMode) {
                        setEditingText(e.target.value);
                      }
                    }}
                    className="min-h-[600px] font-mono text-sm resize-none"
                    readOnly={!isEditMode}
                  />
                )}

                {stats && (
                  <div className="flex flex-wrap gap-2 pt-2">
                    <Badge variant="secondary" className="text-sm px-3 py-1">
                      원본: {stats.originalLength.toLocaleString()}자
                    </Badge>
                    <Badge variant="secondary" className="text-sm px-3 py-1">
                      처리 후: {stats.processedLength.toLocaleString()}자
                    </Badge>
                    <Badge variant="secondary" className="text-sm px-3 py-1">
                      청크: {stats.chunkCount}개
                    </Badge>
                    <Badge variant="secondary" className="text-sm px-3 py-1">
                      평균: {Math.round(stats.processedLength / stats.chunkCount).toLocaleString()}자/청크
                    </Badge>
                  </div>
                )}

                {!isEditMode && (
                  <Button 
                    onClick={handleDownload} 
                    disabled={!processedText}
                    className="w-full h-12 text-base font-semibold"
                    size="lg"
                  >
                    TXT 파일 다운로드
                  </Button>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <ChunkViewerModal 
          isOpen={isChunkModalOpen}
          onClose={() => setIsChunkModalOpen(false)}
          chunks={processedChunks}
        />

        {/* 초기화 확인 다이얼로그 */}
        <AlertDialog open={isResetDialogOpen} onOpenChange={setIsResetDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>정말 초기화하시겠습니까?</AlertDialogTitle>
              <AlertDialogDescription>
                모든 입력 내용과 처리 결과가 삭제됩니다.
                <br />
                이 작업은 되돌릴 수 없습니다.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>취소</AlertDialogCancel>
              <AlertDialogAction onClick={performReset}>
                초기화
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </main>
  );
}
