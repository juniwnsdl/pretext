# 공개 문서 평가 코퍼스

평가일: 2026-07-31

이 목록은 전처리 규칙을 실제 공공 문서 구조와 대조하기 위한 출처·파일 식별 기록이다. 원본 파일은 저작권과 저장소 용량을 고려해 커밋하지 않고 `.tmp/public-corpus/`에만 보관한다. 파일명, 바이트 크기, SHA-256으로 동일 파일 여부를 확인한다.

현재 체크섬을 기록한 실제 파일 수는 Excel 3개, 법령·사규 2개, 설명서·업무 매뉴얼 1개, 일반문서·보고서 1개다. "추가 구조 확인 자료"는 링크와 관찰 근거일 뿐 로컬 파일·기대 출력이 고정된 평가 표본으로 세지 않는다. 그러므로 이 목록은 유형별 완전한 골든 코퍼스가 아니며, 전처리 정확도를 인증하지 않는다.

유형별 3개 이상의 골든 문서를 확보한 뒤에는 각 문서의 기대 청크 경계·머리행·경고, 전처리 설정, 앱·추출기 버전을 함께 고정해야 한다. 그 상태에서 같은 문서를 동일 조건으로 5회 처리하고 결과 해시와 차이를 남기는 반복 재현 평가는 후속 과제다. 현재 문서는 공개 출처 비교의 범위와 한계를 재현 가능하게 밝히는 데까지만 사용한다.

## Excel

| 로컬 파일 | 크기 | SHA-256 | 공식 출처 | 확인한 구조 |
| --- | ---: | --- | --- | --- |
| `excel/kpx-fuel-settlement-2026.xlsx` | 10,660 | `0D99F9F1FD326651E175F694DED6157A7D48C1CB2386E24CDC2B81A6DD4B7C46` | [전력거래소 연료원별 정산금](https://kpx.or.kr/board.es?act=view&bid=0198&list_no=77255&mid=a10109011000&tag=) | 2단 병합 머리행, 합계행, 표 뒤 주석 |
| `excel/kpx-renewable-trading-2026.xlsx` | 30,476 | `62BC7871CE586DF963436A3ECB4A346DDA9F0EE6EA86252CEEFF82E1AB075F5C` | [전력거래소 신재생에너지 거래량](https://kpx.or.kr/board.es?act=view&bid=0083&list_no=77254&mid=a10102000000&tag=) | 2단 병합 머리행, 14열, 데이터 옆 주석 |
| `excel/kpx-assets-2025.xlsx` | 13,038 | `A48E9347AA4D6A5FB51D1D6EE448ED01880437B285E64C64BB8355776A0B05DE` | [전력거래소 자산 현황](https://kpx.or.kr/board.es?act=view&bid=0134&list_no=77352&mid=a10102000000&nPage=1&tag=) | 비 A1 시작 범위, 제목·단위행, 저장된 수식 13개 |

추가 구조 확인 자료: [전력거래소 발전기 예방정비 계획](https://kpx.or.kr/board.es?act=view&bid=0019&list_no=76514&mid=a10109030600&nPage=1&tag=), [공공데이터포털 전력거래 자료](https://www.data.go.kr/data/15064702/fileData.do?recommendDataYn=Y).

## 법령·사규

| 로컬 파일 | 크기 | SHA-256 | 공식 출처 | 확인한 구조 |
| --- | ---: | --- | --- | --- |
| `law/coast-guard-delegation-appendix-2.pdf` | 209,583 | `3C2145FDE7D6FA48122D22892104A11A51A19406016898664B08A6BD657B11D0` | [국가법령정보센터 별표 2](https://www.law.go.kr/LSW/flDownload.do?bylClsCd=200201&flNm=%5B%EB%B3%84%ED%91%9C+2%5D+%EC%86%8C%EC%86%8D+%ED%95%B4%EC%96%91%EA%B2%BD%EC%B0%B0%EC%84%9C+%EC%9C%84%EC%9E%84%EC%A0%84%EA%B2%B0%EC%82%AC%ED%95%AD%28%EC%A0%9C4%EC%A1%B0+%EA%B4%80%EB%A0%A8%29&flSeq=160145665) | `[별표2]` 표지, 20쪽 연속 표, 다단 병합 셀 |
| `law/occupational-safety-appendix-14.pdf` | 84,293 | `F32152473943D585B9196656E348286C7863583E7CF8B153180C93D5C91B4421` | [산업안전보건기준에 관한 규칙 별표 14](https://www.law.go.kr/LSW/flDownload.do?bylClsCd=110201&flSeq=154464391&gubun=) | `■ 법령명 [별표 14]` 표지, 표와 비고 |

추가 구조 확인 자료: [산업안전보건기준에 관한 규칙 본문](https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=273603), [건축법 시행규칙](https://law.go.kr/LSW/lsInfoP.do?chrClsCd=010202&lsId=006191&lsiSeq=283727&urlMode=lsInfoP), [국가법령정보 공동활용 안내](https://open.law.go.kr/LSO/openApi/guideList.do).

## 설명서·업무 매뉴얼

| 로컬 파일 | 크기 | SHA-256 | 공식 출처 | 확인한 구조 |
| --- | ---: | --- | --- | --- |
| `manual/safe-work-permit-manual.pdf` | 490,823 | `F98B9F517068903CCE5F9DAB32FAD832E0498FFA86444167E1E80EC97AA592E7` | [KOSHA 안전사용 허가제 실행 매뉴얼](https://oshri.kosha.or.kr/kosha/data/customneeds.do?articleNo=399206&attachNo=222050&mode=download) | `1 목적` 형식의 제목, 번호 없는 체크리스트, 작업 중지·금지 문구, 복합 표 |

추가 구조 확인 자료: [타워크레인 위험경보 자료](https://kosha.or.kr/kosha/data/confirmation_e.do?articleNo=343342&attachNo=190112&mode=download), [위험성평가 이행·점검 매뉴얼](https://oshri.kosha.or.kr/kosha/business/PublicInstitution_SafetyManagementRecord.do?articleNo=444292&attachNo=250186&mode=download).

## 일반문서·보고서

| 로컬 파일 | 크기 | SHA-256 | 공식 출처 | 확인한 구조 |
| --- | ---: | --- | --- | --- |
| `general/kdb-goods-rfp.pdf` | 460,548 | `ED7C53D86817A682C2FDA91A49D0912BB1D2461D4211AB608135648A6F3FA879` | [나라장터 KDB 굿즈 제안요청서](https://www.g2b.go.kr/pn/pnp/pnpe/UntyAtchFile/downloadFile.do?bidPbancNo=R26BK01428771&bidPbancOrd=000&fileSeq=2&fileType=&prcmBsneSeCd=03) | `I 제안 내용`, 번호 제목, 평가표, `[서식 제1호]`~`[서식 제7호]` |

추가 구조 확인 자료: [KOSHA 연구보고서](https://kosha.or.kr/oshri/publication/researchReportSearch.do?articleNo=411133&attachNo=232371&mode=download), [이천시 탄소중립 계획](https://www.2050cnc.go.kr/storage/board/base/2025/07/02/BOARD_ATTACH_1751439043795.pdf), [부산교육청 회의 자료](https://home.pen.go.kr/upload/hischool/na/bbs_4006/ntt_873339/doc_8df5v9c11-c0vc7-4dvd2-81v84-8041v84a1v6c74_v7089.pdf).

## 평가 방법

각 문서 유형을 다음 다섯 축으로 각각 20점 만점 평가한다.

1. 구조 경계: 조·절·단계·시트·표·부록이 의미 단위에서 나뉘는가
2. 문맥 연속성: 이어지는 제목·주의문·표 머리행이 청크와 함께 유지되는가
3. 표 처리: 병합·다단 머리행·긴 표·비정형 표를 이해 가능한 형태로 보존하는가
4. 손실·중복: 원문 고유 내용이 누락되거나 불필요하게 중복되지 않는가
5. 경고·사용자 통제: 자동 판단이 불확실한 경우 알리고 안전하게 조정할 수 있는가

동일한 다섯 축을 기준으로 코드, 회귀 테스트, 실제 공개 문서 출력, 오탐 방지, 잔여 한계를 순서대로 다섯 차례 점검한다.
