const API_BASE = "https://infl-worker.loto09090909.workers.dev";

// 관리자 페이지: 페이지 저장
function savePage() {
    const name = document.getElementById('name').value;
    const desc = document.getElementById('desc').value;
    const photo = document.getElementById('photo').value;

    // API 호출로 페이지 정보 저장
    fetch(`${API_BASE}/api/pages/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: name,
            description: desc,
            photoUrl: photo
        })
    }).then(response => response.json())
      .then(data => alert('페이지가 저장되었습니다.'))
      .catch(error => alert('저장 실패: ' + error));
}

// 관리자 페이지: 링크 추가
function addLink() {
    const name = document.getElementById('newLinkName').value;
    const url = document.getElementById('newLinkUrl').value;

    // API 호출로 새 링크 추가
    fetch(`${API_BASE}/api/pages/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: name,
            url: url
        })
    }).then(response => response.json())
      .then(data => alert('링크가 추가되었습니다.'))
      .catch(error => alert('링크 추가 실패: ' + error));
}

// 관리자 페이지: 링크 삭제
function removeLink(linkName) {
    // 링크 삭제 로직 (API 호출)
    alert(linkName + ' 링크가 삭제되었습니다.');
}

// 관리자 페이지: 광고 설정 저장
function saveAdsSettings() {
    const adsEnabled = document.getElementById('ads').checked;

    // 광고 설정을 서버에 저장
    fetch(`${API_BASE}/api/pages/saveAds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adsEnabled: adsEnabled })
    }).then(response => response.json())
      .then(data => alert('광고 설정이 저장되었습니다.'))
      .catch(error => alert('광고 설정 실패: ' + error));
}

// 페이지 데이터 로드
async function loadPageData(pageId) {
    if (!pageId || pageId === 'undefined') {
        console.debug('pageId가 없어 페이지 데이터를 요청하지 않습니다.');
        return;
    }

    // 템플릿 문자열 대신 `pageId`를 바로 넣기
    const res = await fetch(`${API_BASE}/api/pages/${encodeURIComponent(pageId)}`);
    
    if (!res.ok) {
        console.error('Failed to fetch page data:', res);
        return;
    }
    
    const data = await res.json();

    if (data && data.profile) {
        document.title = data.profile.name;

        const titleEl = document.querySelector('h1');
        if (titleEl) titleEl.innerText = data.profile.name;

        const photoEl = document.querySelector('.profile-photo');
        if (photoEl && data.profile.photoUrl) photoEl.src = data.profile.photoUrl;

        const descEl = document.querySelector('.profile-description');
        if (descEl && data.profile.description) descEl.innerText = data.profile.description;

        // 링크 동적 삽입
        const linksList = document.getElementById('links-list');
        if (linksList && Array.isArray(data.links)) {
            data.links.forEach(link => {
                const li = document.createElement('li');
                li.innerHTML = `<a href="${link.url}" target="_blank">${link.name}</a>`;
                linksList.appendChild(li);
            });
        }
    } else {
        console.error('Page data not found');
    }
}

// URL에서 pageId (슬러그) 추출
const pathSegments = window.location.pathname.split('/').filter(Boolean);
const isUserPage = pathSegments.length === 2 && pathSegments[0] === 'user' && pathSegments[1];
const looksLikeSlugPage =
    pathSegments.length === 1 &&
    !pathSegments[0].includes('.') &&
    !['admin', 'login'].includes(pathSegments[0]);

if (isUserPage) {
    const pageId = pathSegments[1];
    loadPageData(pageId);
} else if (looksLikeSlugPage) {
    loadPageData(pathSegments[0]);
} else {
    console.debug('사용자 페이지가 아니므로 페이지 데이터 로드를 건너뜁니다.');
}

// 로그인 함수
async function login() {
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const username = usernameInput ? usernameInput.value : '';
    const password = passwordInput ? passwordInput.value : '';

    if (!username || !password) {
        alert('아이디와 비밀번호를 모두 입력하세요.');
        return;
    }

    // 백엔드 API의 절대 경로를 사용하여 요청
    const res = await fetch(`${API_BASE}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });

    if (res.ok) {
        document.cookie = "session=super-admin; path=/; max-age=3600";  // 로그인 성공 시 세션 쿠키 설정 (1시간)
        window.location.href = "/admin.html";  // 관리자 페이지로 리디렉션
    } else {
        alert("로그인 실패");
    }
}

// 인플루언서 페이지 관리자 로그인
async function pageAdminLogin() {
    const passwordInput = document.getElementById('page-admin-password');
    const password = passwordInput ? passwordInput.value : '';
    const inputPageIdEl = document.getElementById('page-admin-id');
    const pageIdFromInput = inputPageIdEl ? inputPageIdEl.value : '';
    const pageIdFromPath =
        pathSegments.length >= 2 && pathSegments[1] === 'admin' ? pathSegments[0] : '';
    const pageId = pageIdFromPath || pageIdFromInput;

    if (!pageId || pageId === 'admin') {
        alert('페이지 식별자가 없어 로그인할 수 없습니다. URL에 /{pageId}/admin 형식으로 접속하거나 페이지 ID를 입력하세요.');
        return;
    }

    if (!password) {
        alert('비밀번호를 입력하세요.');
        return;
    }

    const res = await fetch(`${API_BASE}/api/page/${encodeURIComponent(pageId)}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
    });

    if (res.ok) {
        const session = await res.json();
        sessionStorage.setItem('page_admin_token', session.token);
        window.location.href = `/admin.html?pageId=${encodeURIComponent(pageId)}`;
    } else {
        alert('로그인 실패: 비밀번호를 확인하세요.');
    }
}

// 로그아웃 함수
function logout() {
    document.cookie = "session=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/";  // 세션 쿠키 삭제
    window.location.href = "/login.html";  // 로그인 페이지로 리디렉션
}
