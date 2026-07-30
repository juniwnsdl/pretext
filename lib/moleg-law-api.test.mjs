import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseLawDetailResponse,
  parseLawSearchResponse,
} from './moleg-law-api.ts';

test('law search parser normalizes current-law results and pagination', () => {
  const result = parseLawSearchResponse({
    LawSearch: {
      law: [
        {
          법령일련번호: '287805',
          법령ID: '001766',
          법령명한글: '산업안전보건법',
          법령구분명: '법률',
          소관부처명: '고용노동부',
          공포일자: '20260707',
          공포번호: '21853',
          시행일자: '20260707',
          제개정구분명: '일부개정',
        },
      ],
      totalCnt: '6',
      page: '1',
      numOfRows: '20',
      resultCode: '00',
    },
  });

  assert.deepEqual(result, {
    items: [{
      mst: '287805',
      lawId: '001766',
      name: '산업안전보건법',
      lawType: '법률',
      ministry: '고용노동부',
      promulgationDate: '20260707',
      promulgationNumber: '21853',
      effectiveDate: '20260707',
      revisionType: '일부개정',
    }],
    totalCount: 6,
    page: 1,
    pageSize: 20,
  });
});

test('law search parser accepts a singleton law object and an empty result', () => {
  const singleton = parseLawSearchResponse({
    LawSearch: {
      law: {
        법령일련번호: 123,
        법령ID: 456,
        법령명한글: '테스트법',
        시행일자: 20260101,
      },
      totalCnt: 1,
      page: 1,
      numOfRows: 20,
    },
  });
  assert.equal(singleton.items.length, 1);
  assert.equal(singleton.items[0].mst, '123');

  const empty = parseLawSearchResponse({
    LawSearch: { totalCnt: '0', page: '1', numOfRows: '20' },
  });
  assert.deepEqual(empty.items, []);
});

test('law detail parser preserves hierarchy, addenda, and appendices as legal text', () => {
  const result = parseLawDetailResponse({
    법령: {
      기본정보: {
        법령명_한글: '테스트 안전법',
        법종구분: { content: '법률' },
        소관부처: { content: '테스트부' },
        공포일자: '20260101',
        공포번호: '12345',
        시행일자: '20260701',
      },
      조문: {
        조문단위: [
          { 조문여부: '전문', 조문내용: '  제1장 총칙  ' },
          {
            조문여부: '조문',
            조문내용: '제1조(목적) 이 법은 안전을 정한다. &lt;개정 2026. 1. 1.&gt;',
            항: [
              {
                항내용: '① 첫 번째 항이다.',
                호: {
                  호내용: '1. 첫 번째 호다.',
                  목: [
                    { 목내용: '가. 첫 번째 목이다.' },
                    { 목내용: '나. 두 번째 목이다.' },
                  ],
                },
              },
            ],
          },
        ],
      },
      부칙: {
        부칙단위: {
          부칙내용: [[
            '부칙 <제12345호, 2026. 1. 1.>',
            '제1조(시행일) 이 법은 2026년 7월 1일부터 시행한다.',
          ]],
        },
      },
      별표: {
        별표단위: [
          {
            별표구분: '별표',
            별표번호: '0001',
            별표제목: '안전 기준',
            별표내용: [['[별표 1] 안전 기준', '1. 보호구를 착용한다.']],
          },
          {
            별표구분: '서식',
            별표번호: '0002',
            별표제목: '점검 서식',
            별표내용: '',
          },
        ],
      },
    },
  });

  assert.equal(result.name, '테스트 안전법');
  assert.match(result.text, /^테스트 안전법\n\[법령 정보\]/u);
  assert.match(result.text, /제1장 총칙\n\n제1조\(목적\)/u);
  assert.match(result.text, /① 첫 번째 항이다\.\n1\. 첫 번째 호다\.\n가\. 첫 번째 목이다\./u);
  assert.match(result.text, /<개정 2026\. 1\. 1\.>/u);
  assert.match(result.text, /부칙 <제12345호/u);
  assert.match(result.text, /\[별표 1\] 안전 기준/u);
  assert.match(result.text, /\[별지 2\] 점검 서식/u);
  assert.equal(result.document.fileName, '테스트 안전법.txt');
  assert.equal(result.document.extractionMethod, 'law-api');
  assert.equal(result.document.blocks[0].text, result.text);
  assert.equal(result.document.warnings[0]?.code, 'LAW_API_APPENDIX_TEXT_MISSING');
});

test('law detail parser rejects malformed responses without a law body', () => {
  assert.throws(
    () => parseLawDetailResponse({ resultCode: '01' }),
    /법령 본문/u,
  );
});
