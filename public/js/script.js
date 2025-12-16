function resolveApiBases() {
    const bases = [];

    const metaApiBase = document.querySelector('meta[name="api-base"]')?.content?.trim();
    if (metaApiBase) {
        bases.push(metaApiBase);
    }

    if (window.API_BASE) {
        bases.push(window.API_BASE);
    }

    const knownWorkerBase = 'https://infl-worker.loto09090909.workers.dev';
    if (!bases.includes(knownWorkerBase)) {
        bases.push(knownWorkerBase);
    }

    if (window.location.hostname.endsWith('pages.dev')) {
        const guessedWorker = window.location.origin.replace('.pages.dev', '.workers.dev');
        if (!bases.includes(guessedWorker)) {
            bases.push(guessedWorker);
        }
    }

    bases.push(window.location.origin);

    return bases;
}

const API_BASES = resolveApiBases();

async function apiFetch(
    path,
    options = {},
    fallbackStatuses = [301, 302, 307, 308, 404, 405]
) {
    let lastError;

    for (const base of API_BASES) {
        try {
            const res = await fetch(`${base}${path}`, options);
            if (res.ok) {
                return res;
            }

            if (!fallbackStatuses.includes(res.status)) {
                return res;
            }

            lastError = res;
        } catch (err) {
            lastError = err;
        }
    }

    if (lastError instanceof Response) return lastError;
    throw lastError;
}

const platformHelpers = window.PlatformHelpers || {};
const PLATFORM_PRESETS = platformHelpers.PLATFORM_PRESETS || [];
const getPlatformPreset = platformHelpers.getPlatformPreset || ((platformId) => PLATFORM_PRESETS.find((preset) => preset.id === platformId));
const inferPlatformFromLink = platformHelpers.inferPlatformFromLink || function (link) {
    for (const preset of PLATFORM_PRESETS) {
        if (link.platformId === preset.id) {
            return { preset, handle: link.handle || link.url?.replace(preset.baseUrl, '') || '' };
        }

        if (typeof link.url === 'string' && link.url.startsWith(preset.baseUrl)) {
            return { preset, handle: link.url.slice(preset.baseUrl.length) };
        }
    }

    return null;
};

function createLinkIcon(preset) {
    if (!preset) return null;

    if (!preset.iconPath) {
        const fallback = document.createElement('span');
        fallback.className = 'link-icon platform-icon-fallback';
        fallback.innerText = preset.emoji || '🔗';
        return fallback;
    }

    const icon = document.createElement('img');
    icon.className = 'link-icon';
    icon.src = preset.iconPath;
    icon.alt = preset.label || '';
    icon.onerror = () => {
        const fallback = document.createElement('span');
        fallback.className = 'link-icon platform-icon-fallback';
        fallback.innerText = preset.emoji || '🔗';
        icon.replaceWith(fallback);
    };

    return icon;
}
const hasUserView = document.getElementById("links-list") !== null;
let userViewReady = hasUserView;
let adminLinks = [];

function createCustomIcon(url, alt = "") {
    if (!url) return null;

    const icon = document.createElement('img');
    icon.className = 'link-icon';
    icon.src = url;
    icon.alt = alt;
    icon.onerror = () => icon.remove();
    return icon;
}

function ensureUserViewContainer() {
    if (userViewReady) return;

    const main = document.querySelector('main') || document.body;

    const header = document.createElement('header');
    const title = document.createElement('h1');
    title.innerText = '페이지를 불러오는 중...';
    header.appendChild(title);

    const profileSection = document.createElement('section');
    profileSection.className = 'profile';
    const img = document.createElement('img');
    img.className = 'profile-photo';
    img.alt = '프로필 사진';
    const desc = document.createElement('p');
    desc.className = 'profile-description';
    profileSection.appendChild(img);
    profileSection.appendChild(desc);

    const linksSection = document.createElement('section');
    linksSection.className = 'links';
    const linksHeader = document.createElement('h3');
    linksHeader.innerText = '링크';
    const linksUl = document.createElement('ul');
    linksUl.id = 'links-list';
    linksSection.appendChild(linksHeader);
    linksSection.appendChild(linksUl);

    main.innerHTML = '';
    main.appendChild(header);
    main.appendChild(profileSection);
    main.appendChild(linksSection);

    userViewReady = true;
}

// 페이지 데이터 로드
async function loadPageData(pageId) {
    if (!pageId || pageId === 'undefined') {
        console.debug('pageId가 없어 페이지 데이터를 요청하지 않습니다.');
        return;
    }

    const res = await apiFetch(`/api/pages/${encodeURIComponent(pageId)}`);

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

        renderUserLinks(data.links);

        if (Array.isArray(data.links)) {
            adminLinks = data.links;
            renderAdminLinks();
        }

        const nameInput = document.getElementById('name');
        const descInput = document.getElementById('desc');
        const photoInput = document.getElementById('photo');
        if (nameInput) nameInput.value = data.profile.name ?? '';
        if (descInput) descInput.value = data.profile.description ?? '';
        if (photoInput) photoInput.value = data.profile.photoUrl ?? '';
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
const derivedPageId = pageIdFromPath || pageIdFromQuery || '';

if (looksLikeSlugPage && !userViewReady && !pageRole) {
    ensureUserViewContainer();
}

// 페이지 관리자 대시보드는 토큰과 pageId를 필수로 요구
if (pageRole === 'page-admin') {
    const token = sessionStorage.getItem('page_admin_token');

    if (!token) {
        const redirectTarget = derivedPageId
            ? `/page-admin-login.html?pageId=${encodeURIComponent(derivedPageId)}`
            : '/page-admin-login.html';
        window.location.href = redirectTarget;
    }
}

if (userViewReady || pageRole === 'page-admin') {
    if (isUserPage) {
        const pageId = pathSegments[1];
        loadPageData(pageId);
    } else if (looksLikeSlugPage) {
        loadPageData(pathSegments[0]);
    } else if (isAdminHtml && pageIdFromQuery) {
        loadPageData(pageIdFromQuery);
    } else if (pageRole === 'page-admin' && derivedPageId) {
        loadPageData(derivedPageId);
    } else {
        console.debug('사용자 페이지가 아니므로 페이지 데이터를 로드를 건너뜁니다.');
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
});

// 관리자 페이지: 페이지 저장
async function savePage() {
    if (!derivedPageId) {
        alert('페이지 식별자가 없어 저장할 수 없습니다. URL을 확인해주세요.');
        return;
    }

    const token = sessionStorage.getItem('page_admin_token');
    if (!token) {
        alert('페이지 관리자 로그인이 필요합니다. 다시 로그인 해주세요.');
        return;
    }

    const name = document.getElementById('name')?.value?.trim() || '';
    const desc = document.getElementById('desc')?.value?.trim() || '';
    const photo = document.getElementById('photo')?.value?.trim() || '';

    if (adminLinks.some(link => !link.name || !link.url)) {
        alert('모든 링크는 이름과 URL을 모두 입력해야 합니다.');
        return;
    }

    const payload = {
        profile: { name, description: desc, photoUrl: photo },
        links: adminLinks,
    };

    const res = await apiFetch(`/api/page/${encodeURIComponent(derivedPageId)}/save`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
    });

    if (res.ok) {
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
    const iconInput = document.getElementById('newLinkIcon');

    const name = nameInput?.value?.trim();
    const url = urlInput?.value?.trim();
    const iconUrl = iconInput?.value?.trim();

    if (!name || !url) {
        alert('링크 이름과 URL을 모두 입력하세요.');
        return;
    }

    adminLinks.push({ name, url, iconUrl });
    renderAdminLinks();

    if (nameInput) nameInput.value = '';
    if (urlInput) urlInput.value = '';
    if (iconInput) iconInput.value = '';
}

// 관리자 페이지: 링크 수정/삭제
function updateLinkField(index, field, value) {
    adminLinks[index] = { ...adminLinks[index], [field]: value };
}

function removeLink(index) {
    adminLinks.splice(index, 1);
    renderAdminLinks();
}

function moveLink(index, direction) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= adminLinks.length) return;

    const [item] = adminLinks.splice(index, 1);
    adminLinks.splice(targetIndex, 0, item);
    renderAdminLinks();
}

// 관리자 페이지: 광고 설정 저장 (백엔드 미구현 안내)
function saveAdsSettings() {
    alert('광고 설정 저장 기능은 아직 백엔드에 준비되지 않았습니다.');
}

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

    const res = await apiFetch('/api/admin/login', {
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

    const res = await apiFetch(`/api/page/${encodeURIComponent(pageId)}/login`, {
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

function renderUserLinks(links) {
    const linksList = document.getElementById('links-list');
    if (!linksList || !Array.isArray(links)) return;

    linksList.innerHTML = '';
    links.forEach(link => {
        const li = document.createElement('li');
        const anchor = document.createElement('a');
        anchor.href = link.url || '#';
        anchor.target = '_blank';
        anchor.rel = 'noopener';
        anchor.className = 'link-with-icon';

        const platformInfo = inferPlatformFromLink(link) || (link.platformId ? { preset: getPlatformPreset(link.platformId) } : null);
        const iconEl = platformInfo?.preset
            ? createLinkIcon(platformInfo.preset)
            : createCustomIcon(link.iconUrl, link.name || link.url);

        if (iconEl) anchor.appendChild(iconEl);

        const label = document.createElement('span');
        label.innerText = link.name || link.url;
        anchor.appendChild(label);

        li.appendChild(anchor);
        linksList.appendChild(li);
    });
}

function renderAdminLinks() {
    const adminList = document.getElementById('link-list');
    if (!adminList) return;

    adminList.innerHTML = '';
    adminLinks.forEach((link, index) => {
        const li = document.createElement('li');
        li.className = 'link-row';

        const reorder = document.createElement('div');
        reorder.className = 'reorder-buttons';
        const upBtn = document.createElement('button');
        upBtn.type = 'button';
        upBtn.innerText = '▲';
        upBtn.onclick = () => moveLink(index, -1);
        const downBtn = document.createElement('button');
        downBtn.type = 'button';
        downBtn.innerText = '▼';
        downBtn.onclick = () => moveLink(index, 1);
        reorder.appendChild(upBtn);
        reorder.appendChild(downBtn);

        const nameInput = document.createElement('input');
        nameInput.placeholder = '링크 이름';
        nameInput.value = link.name || '';
        nameInput.oninput = (e) => updateLinkField(index, 'name', e.target.value);

        const urlInput = document.createElement('input');
        urlInput.placeholder = '링크 URL';
        urlInput.value = link.url || '';
        urlInput.oninput = (e) => updateLinkField(index, 'url', e.target.value);

        const iconInput = document.createElement('input');
        iconInput.placeholder = '아이콘 URL (선택)';
        iconInput.value = link.iconUrl || '';
        iconInput.oninput = (e) => updateLinkField(index, 'iconUrl', e.target.value);

        const iconPreview = createCustomIcon(link.iconUrl, link.name || '아이콘');
        if (iconPreview) {
            iconPreview.classList.add('custom-icon-preview');
        }

        const previewLink = document.createElement('a');
        previewLink.href = link.url || '#';
        previewLink.target = '_blank';
        previewLink.innerText = '미리보기';

        const removeBtn = document.createElement('button');
        removeBtn.innerText = '삭제';
        removeBtn.onclick = () => removeLink(index);

        li.appendChild(reorder);
        li.appendChild(nameInput);
        li.appendChild(urlInput);
        li.appendChild(iconInput);
        if (iconPreview) li.appendChild(iconPreview);
        li.appendChild(previewLink);
        li.appendChild(removeBtn);
        adminList.appendChild(li);
    });
}
