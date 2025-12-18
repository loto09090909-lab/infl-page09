# 슈퍼 관리자 부트스트랩 가이드

슈퍼 관리자 로그인을 위해서는 `super_admins` 테이블에 아이디와 비밀번호 해시가 있어야 합니다. 비밀번호는 SHA-256 해시로 저장하며, 아래 두 가지 방법 중 하나로 초기 계정을 준비할 수 있습니다.

## 1) API로 부트스트랩

1. 워커를 실행한 뒤 `/api/admin/bootstrap` 또는 `/api/super-admin/bootstrap` 엔드포인트에 `POST` 요청을 보냅니다.
2. 바디는 `{"username": "admin", "password": "원하는비밀번호"}` 형태의 JSON입니다.
3. 첫 계정이 없으면 누구나 생성할 수 있고, 이후에는 기존 슈퍼 관리자 토큰(`Authorization: Bearer <token>`)이 있어야 추가/재설정이 됩니다.
4. 응답 예시:
   ```json
   { "success": true, "username": "admin", "mode": "bootstrapped", "passwordHash": "<sha256>" }
   ```

## 2) D1에 직접 시드

1. 사용할 아이디/비밀번호를 정한 뒤 SHA-256 해시를 만듭니다. `public/login.html`의 "D1 시드 SQL 보기" 버튼을 눌러 브라우저에서 즉시 해시와 SQL을 생성할 수 있습니다.
2. 생성된 SQL을 D1 콘솔이나 `wrangler d1 execute`에 넣어 실행합니다. 예시:
   ```sql
   INSERT OR REPLACE INTO super_admins (username, password_hash)
   VALUES ('admin', '<sha256-hash>');
   ```
3. 이후 `/api/admin/login`에 같은 아이디/비밀번호로 로그인하면 토큰을 받을 수 있습니다.

> 비밀번호는 평문이 아닌 SHA-256 해시로 저장해야 합니다. 기존에 평문을 넣어 둔 경우, 위 방법 중 하나로 해시를 다시 시드한 뒤 로그인하세요.
