# Legacy → v2 Schema Migration Playbook

## 목표
- `super_admin`, `page_auth`, `page_meta`, `page_stats`, `slug_map`를 신규 스키마(`admins`, `pages`, `page_slugs`, `page_stats_daily`, `page_stats_hourly`)로 통합합니다.
- 기존 데이터는 백업 테이블로 보존하고, 신규 테이블로 백필한 뒤 제약조건/인덱스를 활성화합니다.

## 실행 순서 (스테이징 기준)
1. **사전 백업**: 최신 D1 스냅샷을 저장합니다.
   ```bash
   wrangler d1 export <DB_NAME> --remote ./backups/d1-pre-v2.sql
   ```
2. **마이그레이션 스크립트 적용**: 제공된 SQL을 스테이징에 먼저 실행합니다.
   ```bash
   wrangler d1 execute <DB_NAME> --remote --file=./db/migrations/2024-legacy-to-v2.sql
   ```
3. **검증**
   - 신규 테이블 생성/백필 확인
     ```bash
     wrangler d1 execute <DB_NAME> --remote --command=".tables"
     wrangler d1 execute <DB_NAME> --remote --command="SELECT COUNT(*) FROM pages;"
     wrangler d1 execute <DB_NAME> --remote --command="SELECT COUNT(*) FROM page_slugs;"
     wrangler d1 execute <DB_NAME> --remote --command="SELECT COUNT(*) FROM admins WHERE role='PAGE';"
     wrangler d1 execute <DB_NAME> --remote --command="SELECT COUNT(*) FROM page_stats_daily;"
     ```
   - 기본 슬러그/페이지 매핑 누락 확인
     ```bash
     wrangler d1 execute <DB_NAME> --remote --command="SELECT page_id FROM pages EXCEPT SELECT page_id FROM page_slugs WHERE is_primary=1;"
     ```
4. **애플리케이션 리허설**
   - 스테이징 워커를 신규 스키마를 바라보도록 설정한 뒤 `GET /api/pages/:id` 및 관리자 로그인 흐름을 수동 점검합니다.
   - 누락된 페이지/슬러그가 있다면 백업 테이블에서 추출해 수동 보정합니다.
5. **프로덕션 적용**: 스테이징 검증이 끝나면 동일한 순서로 프로덕션에 실행합니다.

## 롤백 전략
- 모든 단계에서 `backup_*` 테이블과 사전 스냅샷을 활용합니다.
- 신규 스키마에서 문제 발생 시 다음 순서로 복원합니다.
  1. 트랜잭션 범위를 넘어선 추가 쓰기가 없는지 확인 후 신규 테이블을 별도 접두사(`broken_*`)로 잠시 보관합니다.
  2. 백업 테이블을 원래 이름으로 복원합니다.
     ```sql
     ALTER TABLE legacy_super_admin RENAME TO super_admin;
     ALTER TABLE legacy_page_auth RENAME TO page_auth;
     ALTER TABLE legacy_page_meta RENAME TO page_meta;
     ALTER TABLE legacy_page_stats RENAME TO page_stats;
     ALTER TABLE legacy_slug_map RENAME TO slug_map;
     ```
  3. 필요 시 스냅샷으로 전체 DB를 덮어씁니다 (`wrangler d1 import`).
- 롤백 후 신규 스키마 재적용 시에는 `legacy_*` 테이블 이름이 남지 않도록 정리한 뒤 다시 실행합니다.

## 추가 메모
- 데이터 백필 구간은 `CREATE TABLE IF NOT EXISTS`와 `INSERT OR IGNORE`를 사용했지만, 마지막에 수행하는 `ALTER TABLE ... RENAME TO legacy_*` 단계 때문에 **환경당 1회 실행**을 전제로 합니다. 재실행 시에는 우선 `legacy_*` 테이블을 원래 이름으로 복구한 뒤 재적용하세요.
- `page_stats_daily.revenue_cents`는 기존 `revenue`(REAL)를 센트 단위 정수로 변환합니다.
- `page_slugs`는 슬러그가 없던 페이지에 대해 `page_id`를 기본 슬러그로 생성합니다.
