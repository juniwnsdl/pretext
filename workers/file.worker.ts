import {
  extractWorkbookDocument,
// @ts-expect-error Node's type-stripping runtime requires the explicit .ts extension.
} from '../lib/excel-workbook-extractor.ts';

interface ExcelWorkerRequest {
  type: 'excel';
  fileName: string;
  buffer: ArrayBuffer;
}

interface UnsupportedWorkerRequest {
  type: string;
  fileName?: string;
  buffer?: ArrayBuffer;
}

type FileWorkerRequest = ExcelWorkerRequest | UnsupportedWorkerRequest;

export function workerErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

self.onmessage = (event: MessageEvent<FileWorkerRequest>): void => {
  try {
    const request = event.data;
    if (request.type !== 'excel') {
      throw new Error(`Unsupported file type: ${request.type}`);
    }
    if (!request.fileName || !(request.buffer instanceof ArrayBuffer)) {
      throw new Error('Invalid Excel worker request.');
    }

    const document = extractWorkbookDocument(request.buffer, request.fileName);
    self.postMessage({ status: 'success', document });
  } catch (error) {
    self.postMessage({
      status: 'error',
      error: workerErrorMessage(error),
    });
  }
};
