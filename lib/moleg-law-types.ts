import type { ExtractedDocument } from './preprocessing/contracts';

export interface MolegLawSearchItem {
  mst: string;
  lawId: string;
  name: string;
  lawType: string;
  ministry: string;
  promulgationDate: string;
  promulgationNumber: string;
  effectiveDate: string;
  revisionType: string;
}
export interface MolegLawSearchResult {
  items: MolegLawSearchItem[];
  totalCount: number;
  page: number;
  pageSize: number;
}

export interface MolegLawDetailResult {
  name: string;
  text: string;
  document: ExtractedDocument;
}
