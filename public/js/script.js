const API_BASE = window.API_BASE || "";
const hasUserView = document.getElementById("links-list") !== null;
let currentLinks = [];
let currentProfile = {};

function getAdminPageId() {
    return pageIdFromPath || pageIdFromQuery || '';
}

// 관리자 페이지: 링크 목록 렌더링
function renderLinks() {
    const linkList = document.getElementById('link-list');
    if (!linkList) return;

    linkList.innerHTML = '';
    currentLinks.forEach((link, idx) => {
        const li = document.createElement('li');
        const nameSpan = document.createElement('span');
        nameSpan.innerText = `${link.name} - ${link.url}`;

        const removeBtn = document.createElement('button');
        removeBtn.innerText = '삭제';
        removeBtn.onclick = () => removeLink(idx);

        li.appendChild(nameSpan);
        li.appendChild(removeBtn);
        linkList.appendChild(li);
    });
}

// 관리자 페이지: 페이지 저장
async function savePage() {
    const pageId = getAdminPageId();
    if (!pageId) {
        alert('페이지 식별자를 알 수 없어 저장할 수 없습니다.');
        return;
    }

    const token = sessionStorage.getItem('page_admin_token');
    if (!token) {
        alert('페이지 관리자 로그인이 필요합니다. 다시 로그인해 주세요.');
        return;
    }

    const name = document.getElementById('name')?.value || '';
    const desc = document.getElementById('desc')?.value || '';
    const photo = document.getElementById('photo')?.value || '';
    const adsCheckbox = document.getElementById('ads');
    const adsEnabled = adsCheckbox ? adsCheckbox.checked : undefined;

    const profile = {
        ...currentProfile,
        name,
        description: desc,
        photoUrl: photo,
    };

    if (typeof adsEnabled === 'boolean') {
        profile.adsEnabled = adsEnabled;
    }

    const res = await fetch(`${API_BASE}/api/page/${encodeURIComponent(pageId)}/save`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ profile, links: currentLinks }),
    });

    if (res.ok) {
        currentProfile = profile;
        alert('페이지가 저장되었습니다.');
    } else {
        const errText = await res.text();
        alert(`저장 실패: ${errText || res.status}`);
    }
}

// 관리자 페이지: 링크 추가
function addLink() {
    const nameInput = document.getElementById('newLinkName');
    const urlInput = document.getElementById('newLinkUrl');
    const name = nameInput?.value.trim();
    const url = urlInput?.value.trim();

    if (!name || !url) {
        alert('링크 이름과 URL을 모두 입력하세요.');
        return;
    }

    currentLinks.push({ name, url });
    renderLinks();

    if (nameInput) nameInput.value = '';
    if (urlInput) urlInput.value = '';
}

// 관리자 페이지: 링크 삭제
function removeLink(index) {
    currentLinks.splice(index, 1);
    renderLinks();
}

// 관리자 페이지: 광고 설정 저장 (페이지 저장 로직과 공유)
function saveAdsSettings() {
    savePage();
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
            linksList.innerHTML = '';
            data.links.forEach(link => {
                const li = document.createElement('li');
                li.innerHTML = `<a href="${link.url}" target="_blank">${link.name}</a>`;
                linksList.appendChild(li);
            });
        }

        if (pageRole === 'page-admin') {
            currentProfile = data.profile || {};
            currentLinks = Array.isArray(data.links) ? data.links.slice() : [];

            const nameInput = document.getElementById('name');
            if (nameInput) nameInput.value = data.profile.name || '';

            const descInput = document.getElementById('desc');
            if (descInput) descInput.value = data.profile.description || '';

            const photoInput = document.getElementById('photo');
            if (photoInput) photoInput.value = data.profile.photoUrl || '';

            const adsCheckbox = document.getElementById('ads');
            if (adsCheckbox) adsCheckbox.checked = Boolean(data.profile.adsEnabled);

            renderLinks();
        }
    } else {
        console.error('Page data not found');
    }
}

// URL에서 pageId (슬러그) 추출
const pathSegments = window.location.pathname.split('/').filter(Boolean);
const searchParams = new URLSearchParams(window.location.search);
const pageIdFromQuery = searchParams.get('pageId');
const pageRole = document.body?.dataset?.pageRole;
const pageIdFromPath =
    pathSegments.length >= 2 && pathSegments[1] === 'admin' ? pathSegments[0] : '';
const isUserPage = pathSegments.length === 2 && pathSegments[0] === 'user' && pathSegments[1];
const looksLikeSlugPage =
    pathSegments.length === 1 &&
    !pathSegments[0].includes('.') &&
    !['admin', 'login', 'super-admin', 'super-admin.html', 'page-admin-login'].includes(pathSegments[0]);
const isAdminHtml = pathSegments.length === 1 && pathSegments[0].startsWith('admin');

// 페이지 관리자 대시보드는 토큰과 pageId를 필수로 요구
if (pageRole === 'page-admin') {
    const derivedPageId = pageIdFromPath || pageIdFromQuery || '';
    const token = sessionStorage.getItem('page_admin_token');

    if (!token) {
        const redirectTarget = derivedPageId
            ? `/page-admin-login.html?pageId=${encodeURIComponent(derivedPageId)}`
            : '/page-admin-login.html';
        window.location.href = redirectTarget;
    }
}

if (hasUserView) {
    if (isUserPage) {
        const pageId = pathSegments[1];
        loadPageData(pageId);
    } else if (looksLikeSlugPage) {
        loadPageData(pathSegments[0]);
    } else if (isAdminHtml && pageIdFromQuery) {
        loadPageData(pageIdFromQuery);
    } else {
        console.debug('사용자 페이지가 아니므로 페이지 데이터 로드를 건너뜁니다.');
    }
} else {
    console.debug('사용자 페이지 컨테이너가 없어 페이지 데이터를 요청하지 않습니다.');
}

// 페이지 관리자 로그인 화면에서 URL로 받은 pageId를 자동 입력
document.addEventListener('DOMContentLoaded', () => {
    const pageAdminIdInput = document.getElementById('page-admin-id');
    if (pageAdminIdInput && (pageIdFromPath || pageIdFromQuery)) {
        pageAdminIdInput.value = pageIdFromPath || pageIdFromQuery;
    }

    if (pageRole === 'page-admin') {
        const pageId = getAdminPageId();
        if (pageId) {
            loadPageData(pageId);
        }
    }
});

// 로그인 함수
async function login() {
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    // username이 비어 있으면 기본 값 'admin'을 사용하여 기존 단일 계정과 호환
    const username = usernameInput && usernameInput.value ? usernameInput.value : 'admin';
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
        const session = await res.json();
        if (session?.token) {
            sessionStorage.setItem('super_admin_token', session.token);
        }
        window.location.href = "/super-admin.html";  // 슈퍼 관리자 페이지로 리디렉션
    } else {
        const errText = await res.text();
        alert(`로그인 실패: ${errText || res.status}`);
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
