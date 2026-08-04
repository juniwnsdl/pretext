# MISO 워크플로우 API 명세

## 엔드포인트
`POST https://api.holdings.miso.gs/ext/v1/workflows/run`

## 입력 변수 (Input Variables)
- input (file, 필수): input

## 출력 변수 (Output Variables)  
- **result** (string): result

    ## 요청 형식 (Request Format)
```json
{
  "url": "https://api.holdings.miso.gs/ext/v1/workflows/run",
  "method": "POST",
  "headers": {
    "Authorization": "Bearer {API_KEY}",
    "Content-Type": "application/json"
  },
  "body": {
    "inputs": {
      "input": null
    },
    "files": [],
    "mode": "blocking or streaming"
  }
}
```

    ## 응답 형식 (Response Format)  
```json
{
  "id": "workflow_run_id",
  "workflow_id": "workflow_id",
  "status": "succeeded",
  "inputs": {
    "input": null
  },
  "outputs": {
    "result": "result 결과값"
  },
  "error": null,
  "total_steps": 2,
  "total_tokens": 0,
  "created_at": "2025-11-18T02:09:10.519Z",
  "finished_at": "2025-11-18T02:09:10.519Z",
  "elapsed_time": 1.23
}
```

    ## 사용 예시 (cURL)
```bash
curl -X POST 'https://api.holdings.miso.gs/ext/v1/workflows/run' \
  -H 'Authorization: Bearer {MISO_API_KEY}' \
  -H 'Content-Type: application/json' \
      -d '{
  "inputs": {
    "input": null
  },
  "files": [],
  "mode": "blocking or streaming"
}'
```

## 참고사항
* `mode` (string) 필수
  * 응답 반환 방식으로, 다음 두 가지 모드를 지원합니다:
  * `streaming`: 스트리밍 모드 (권장)\
    Server-Sent Events(SSE)를 활용하여 결과를 순차적으로 반환합니다.
  * `blocking`: 블로킹 모드\
    모든 실행이 완료된 후 결과를 한 번에 반환합니다.
* `user` (string) 필수
  * 최종 사용자 식별자
  * 통계 및 조회 목적 사용할 사용자 이름입니다.
  * 필요에 따라 임의로 지정하여 사용합니다.
* `files` (array\[object]) 선택
  * 텍스트 이해 및 질문 응답에 파일 입력이 필요한 경우 사용합니다.
  * 해당 모델이 파일 파싱 및 이해 기능을 지원하는 경우에만 사용 가능합니다.
  * `type`  지원되는 파일 타입
    * 문서(Document): `TXT`, `MD`, `MARKDOWN`, `PDF`, `HTML`, `XLSX`, `XLS`, `DOCX`, `CSV`, `EML`, `MSG`, `PPTX`, `PPT`, `XML`, `EPUB`
    * 이미지(Image): `JPG`, `JPEG`, `PNG`, `GIF`, `WEBP`, `SVG`
    * 오디오(Audio): `MP3`, `M4A`, `WAV`, `WEBM`, `AMR`
    * 비디오(Video): `MP4`, `MOV`, `MPEG`, `MPGA`
    * 기타(Custom): 기타 확장자 파일
  * `transfer_method` (string)
    * 파일 전달 방식 설정:
      * `remote_url`: URL을 통한 이미지 전달
      * `local_file`: 파일 업로드 API를 통해 업로드한 파일 ID를 이용
  * `url` (string)
    * `transfer_method`가 `remote_url`일 경우 사용
    * 전달할 이미지의 URL 입력
  * `upload_file_id` (string)
    * `transfer_method`가 `local_file`일 경우 사용
    * 파일 업로드 API를 통해 사전 업로드한 파일의 ID 입력




**Errors**
* `400`, `invalid_param`
  * 잘못된 파라미터 입력
  * Workflow not published: 앱이 발행되지 않았음. 미소 앱 편집화면에서 저장버튼을 눌러주세요.
* `400`, `app_unavailable`
  * 앱(App) 설정 정보를 사용할 수 없음
* `400`, `provider_not_initialize`
  * 사용 가능한 모델 인증 정보가 없음
* `400`, `provider_quota_exceeded`
  * 모델 호출 쿼터(Quota) 초과
* `400`, `model_currently_not_support`
  * 현재 모델을 사용할 수 없음
* `400`, `workflow_request_error`
  * 워크플로우 실행 실패
* `500`, `internal_server_error`
  * 내부 서버 오류


# 개발 가이드라인
* API 호출이 실패하면 응답의 detail message와 해결방안을 한글로 화면에 표시해줘.
* 환경변수로 MISO_API_KEY를 입력받을 수 있게 하라.