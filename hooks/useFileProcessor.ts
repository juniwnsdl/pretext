import { useState, useCallback } from 'react';
import type { DocType } from '@/lib/text-preprocessor';
import {
  getFileExtension,
  getFileProcessingRoute,
  isFileSizeAllowed,
} from '@/lib/file-processing-policy';

export interface ProcessStats {
  originalLength: number;
  processedLength: number;
  chunkCount: number;
}

export interface UseFileProcessorReturn {
  // States
  file: File | null;
  inputText: string;
  processedText: string;
  processedChunks: string[];
  docType: DocType;
  separator: string;
  stats: ProcessStats | null;
  error: string | null;
  status: 'idle' | 'reading' | 'uploading' | 'processing' | 'complete' | 'error';
  
  // Actions
  setFile: (file: File | null) => void;
  setInputText: (text: string) => void;
  setDocType: (type: DocType) => void;
  setSeparator: (separator: string) => void;
  setProcessedText: (text: string) => void;
  updateChunks: (chunks: string[]) => void;
  reset: () => void;
  
  // Async Actions
  handleFileRead: (file: File) => Promise<void>;
  processText: () => Promise<void>;
}

export function useFileProcessor(): UseFileProcessorReturn {
  // State Definitions
  const [file, setFileState] = useState<File | null>(null);
  const [inputText, setInputText] = useState('');
  const [processedText, setProcessedText] = useState('');
  const [processedChunks, setProcessedChunks] = useState<string[]>([]);
  const [stats, setStats] = useState<ProcessStats | null>(null);
  const [docType, setDocType] = useState<DocType>('general');
  const [separator, setSeparator] = useState<string>('@@@');
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'reading' | 'uploading' | 'processing' | 'complete' | 'error'>('idle');

  const setFile = useCallback((newFile: File | null) => {
    setFileState(newFile);
    if (!newFile) {
      setError(null);
    }
  }, []);

  const reset = useCallback(() => {
    setFileState(null);
    setInputText('');
    setProcessedText('');
    setProcessedChunks([]);
    setStats(null);
    setError(null);
    setStatus('idle');
    setDocType('general');
    setSeparator('@@@');
  }, []);

  // 1. File Reading Logic
  const handleFileRead = useCallback(async (selectedFile: File) => {
    if (!isFileSizeAllowed(selectedFile.size)) {
      setError('파일 용량이 50MB를 초과했습니다.');
      return;
    }

    const processingRoute = getFileProcessingRoute(selectedFile.name);
    if (processingRoute === 'unsupported') {
      setFile(selectedFile);
      setError('지원하지 않는 파일 형식입니다. PDF, DOCX 또는 TXT 등 지원 형식으로 변환해주세요.');
      setStatus('error');
      return;
    }

    setFile(selectedFile);
    setStatus('reading');
    setError(null);

    const fileExtension = getFileExtension(selectedFile.name);

    try {
      // 1-1. Text Files
      if (processingRoute === 'local-text') {
        const text = await selectedFile.text();
        setInputText(text);
        
        setDocType(fileExtension === 'csv' ? 'excel' : 'general');
        
        setStatus('idle');
        return;
      }

      // 1-2. Excel Files (Processed via Web Worker)
      if (processingRoute === 'local-excel') {
        return new Promise<void>((resolve, reject) => {
          const worker = new Worker(new URL('../workers/file.worker.ts', import.meta.url));
          
          worker.onmessage = (e) => {
            const { status, text, error } = e.data;
            if (status === 'success') {
              setInputText(text);
              setDocType('excel');
              setStatus('idle');
              worker.terminate(); // 작업 완료 후 종료
              resolve();
            } else {
              const errMsg = error || '엑셀 처리 중 오류 발생';
              setError(errMsg);
              setStatus('error');
              worker.terminate();
              // reject(new Error(errMsg)); // UI상 에러 처리는 setError로 하므로 굳이 reject 안해도 됨
            }
          };

          worker.onerror = (err) => {
            console.error('Worker error:', err);
            setError('엑셀 처리 워커 오류');
            setStatus('error');
            worker.terminate();
          };

          worker.postMessage({ file: selectedFile, type: 'excel' });
        });
      }

      // 1-3. Others (Miso API)
      setStatus('uploading');
      
      const uploadFormData = new FormData();
      uploadFormData.append('file', selectedFile);

      const uploadResponse = await fetch('/api/miso/upload', {
        method: 'POST',
        body: uploadFormData,
      });

      const uploadResult = await uploadResponse.json();
      if (!uploadResponse.ok) throw new Error(uploadResult.error || '업로드 실패');

      const workflowResponse = await fetch('/api/miso', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          fileId: uploadResult.fileId,
          fileName: uploadResult.fileName 
        }),
      });

      const workflowResult = await workflowResponse.json();
      if (!workflowResponse.ok) throw new Error(workflowResult.error || '처리 실패');

      setInputText(workflowResult.data.result);
      setDocType('general');
      setStatus('idle');

    } catch (err) {
      console.error('File processing error:', err);
      setError(err instanceof Error ? err.message : '파일 처리 중 오류가 발생했습니다.');
      setStatus('error');
    }
  }, [setFile]);

  // 2. Preprocessing Logic
  const processText = useCallback(async () => {
    if (!inputText.trim()) {
      setError('처리할 텍스트가 없습니다.');
      return;
    }

    setStatus('processing');
    setError(null);

    try {
      const response = await fetch('/api/preprocess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: inputText,
          docType,
          separator,
        }),
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error);

      setProcessedText(result.data.processedText);
      setProcessedChunks(result.data.chunks || []);
      setStats(result.data.stats);
      setStatus('complete');
    } catch (err) {
      setError(err instanceof Error ? err.message : '전처리 중 오류가 발생했습니다.');
      setStatus('error');
    }
  }, [inputText, docType, separator]);

  // 청크 수동 업데이트
  const updateChunks = useCallback((newChunks: string[]) => {
    setProcessedChunks(newChunks);
    // 구분자 앞뒤로 줄바꿈을 추가하여 독립적인 줄에 위치하도록 함
    const newProcessedText = newChunks.join(`\n\n${separator}\n\n`);
    setProcessedText(newProcessedText);
    
    // 통계 업데이트
    if (stats) {
      setStats({
        ...stats,
        processedLength: newProcessedText.length,
        chunkCount: newChunks.length
      });
    }
  }, [separator, stats]);

  return {
    file,
    inputText,
    processedText,
    processedChunks,
    docType,
    separator,
    stats,
    error,
    status,
    setFile,
    setInputText,
    setDocType,
    setSeparator,
    setProcessedText,
    updateChunks,
    reset,
    handleFileRead,
    processText,
  };
}

