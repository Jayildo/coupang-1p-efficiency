# 쿠팡 1p 효율화 프로젝트

## 프로젝트 개요
쿠팡 물류 운영을 위한 워크스페이스 SPA.
발주서 분석, PDF 거래명세서 필터링, 적재리스트 관리, 사용자 피드백 수집.

## 기술 스택
- React 18 + Vite 5
- Supabase (DB + Auth 없이 anonymous 사용)
- pdfjs-dist + pdf-lib (PDF 처리)
- xlsx (스프레드시트)
- JSZip (ZIP 아카이브)

## 로컬 실행
```bash
cp .env.example .env
# .env에 Supabase 키 입력
npm install
npm run dev
```

## 배포
- Vercel Pro 플랜 (상업적 사용 — Google AdSense)
- 환경변수는 Vercel 대시보드에서 설정

## 주요 모듈
| 모듈 | 파일 | 역할 |
|------|------|------|
| 발주 분석 | OrderWorkbench.jsx | 센터별 그룹핑, CBM, 팔레트, 운송비 |
| 문서 정리 | DocumentWorkbench.jsx | 쿠팡 PDF 제출용 페이지 추출 |
| 적재 관리 | LoadingWorkbench.jsx | 박스/팔레트 배정, XLSX 내보내기 |
| 피드백 | FeedbackWorkbench.jsx | 사용자 건의/공감 (Supabase 연동) |

## Supabase 테이블
- `skulist` — SKU별 CBM 데이터
- `milk_run_costs` — 센터별 운송비
- `suggestions` — 사용자 건의사항
- `reactions` — 건의 공감 (중복 방지)

## 규칙
- Supabase 미연동 시에도 기본 기능 동작 (graceful degradation)
- 컬럼명 매칭은 한/영 별칭 자동 인식
- 익명 사용 (로그인 없음), fingerprint로 중복 공감 차단
