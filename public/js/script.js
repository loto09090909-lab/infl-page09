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
const buildPlatformUrl = platformHelpers.buildPlatformUrl || function (preset, handle) {
    const cleanHandle = (handle || '').trim().replace(/^\/+/, '');
    return preset && cleanHandle ? `${preset.baseUrl}${cleanHandle}` : '';
};
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
let selectedPlatformId = PLATFORM_PRESETS[0]?.id || '';
let dragState = null;

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

    document.body.classList.add('user-view');

    const host = document.querySelector('main') || document.body;
    host.innerHTML = '';

    const shell = document.createElement('main');
    shell.className = 'user-shell';

    const card = document.createElement('section');
    card.className = 'user-card';

    const header = document.createElement('header');
    header.className = 'user-header';
    const title = document.createElement('h1');
    title.innerText = '페이지를 불러오는 중...';
    header.appendChild(title);

    const profileSection = document.createElement('div');
    profileSection.className = 'profile user-profile';
    const img = document.createElement('img');
    img.className = 'profile-photo user-avatar';
    img.alt = '프로필 사진';
    const desc = document.createElement('p');
    desc.className = 'profile-description';
    profileSection.appendChild(img);
    profileSection.appendChild(desc);

    const linksSection = document.createElement('section');
    linksSection.className = 'links user-links';
    const linksHeader = document.createElement('h3');
    linksHeader.innerText = '링크';
    const linksUl = document.createElement('ul');
    linksUl.id = 'links-list';
    linksUl.className = 'link-stack';
    linksSection.appendChild(linksHeader);
    linksSection.appendChild(linksUl);

    const footer = document.createElement('footer');
    footer.className = 'user-footer';
    footer.innerHTML = '<p>&copy; 2025 인플루언서 페이지</p>';

    card.appendChild(header);
    card.appendChild(profileSection);
    card.appendChild(linksSection);
    card.appendChild(footer);

    shell.appendChild(card);
    host.appendChild(shell);

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
        updatePageContext(pageId, data.profile);
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

function updatePageContext(pageId, profile = {}) {
    const badge = document.getElementById('current-page-id');
    if (badge) {
        badge.innerText = pageId || '-';
    }

    const publicLink = document.getElementById('public-link');
    if (publicLink) {
        if (pageId) {
            publicLink.href = `/${encodeURIComponent(pageId)}`;
            publicLink.style.visibility = 'visible';
        } else {
            publicLink.href = '#';
            publicLink.style.visibility = 'hidden';
        }
    }

    const adminPageTitle = document.querySelector('.page-hero h1');
    if (adminPageTitle && profile?.name) {
        adminPageTitle.innerText = `${profile.name} 페이지 관리`;
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
const isUserHtml = window.location.pathname.endsWith('/user.html');
const isPublicView = !pageRole && (isUserPage || looksLikeSlugPage || isUserHtml);
const derivedPageId = pageIdFromPath || pageIdFromQuery || '';

if (isPublicView) {
    document.body.classList.add('user-view');
}

if (pageRole === 'page-admin' && derivedPageId) {
    updatePageContext(derivedPageId);
}

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

    if (document.body?.dataset?.pageRole === 'page-admin') {
        renderPlatformSelector();
        updatePlatformPrefix();
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

function reorderList(list, from, to) {
    if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return;

    const [item] = list.splice(from, 1);
    list.splice(to, 0, item);
}

function attachDragHandlers(li, index, listType) {
    li.draggable = true;
    li.dataset.index = String(index);

    li.addEventListener('dragstart', (e) => {
        dragState = { listType, from: index };
        li.classList.add('dragging');
        li.parentElement?.classList.add('drag-active');
        e.dataTransfer.effectAllowed = 'move';
    });

    li.addEventListener('dragend', () => {
        li.classList.remove('dragging');
        li.classList.remove('drag-over');
        li.dataset.direction = '';
        li.parentElement?.classList.remove('drag-active');
        dragState = null;
    });

    li.addEventListener('dragover', (e) => {
        if (!dragState || dragState.listType !== listType) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    });

    li.addEventListener('dragenter', () => {
        if (dragState && dragState.listType === listType && dragState.from !== index) {
            li.dataset.direction = dragState.from < index ? 'down' : 'up';
            li.classList.add('drag-over');
        }
    });

    li.addEventListener('dragleave', () => {
        li.classList.remove('drag-over');
        li.dataset.direction = '';
    });

    li.addEventListener('drop', (e) => {
        if (!dragState || dragState.listType !== listType) return;
        e.preventDefault();
        const targetIndex = index;
        if (dragState.from !== targetIndex) {
            if (listType === 'admin-links') {
                moveLink(dragState.from, targetIndex - dragState.from);
            }
        }
        li.classList.remove('drag-over');
        li.dataset.direction = '';
        li.parentElement?.classList.remove('drag-active');
    });
}

function setPlatformSelection(platformId) {
    selectedPlatformId = platformId;
    renderPlatformSelector();
    updatePlatformPrefix();
}

function updatePlatformPrefix() {
    const prefixEl = document.getElementById('platform-prefix');
    const handleInput = document.getElementById('platformHandle');
    const preset = getPlatformPreset(selectedPlatformId) || PLATFORM_PRESETS[0];

    if (prefixEl) {
        prefixEl.innerText = preset?.baseUrl || '';
    }

    if (handleInput) {
        handleInput.placeholder = preset?.placeholder || '채널/프로필 ID';
    }
}

function renderPlatformSelector() {
    const selector = document.getElementById('platform-selector');
    if (!selector) return;

    selector.innerHTML = '';

    PLATFORM_PRESETS.forEach((preset) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `platform-button${preset.id === selectedPlatformId ? ' active' : ''}`;
        button.title = preset.label;
        const iconEl = createLinkIcon(preset) || document.createElement('span');
        iconEl.classList.add('platform-icon');
        const labelEl = document.createElement('span');
        labelEl.className = 'platform-button-label';
        labelEl.innerText = preset.label;
        button.appendChild(iconEl);
        button.appendChild(labelEl);
        button.onclick = () => setPlatformSelection(preset.id);
        selector.appendChild(button);
    });
}

// 관리자 페이지: 링크 추가
function addCustomLink() {
    const nameInput = document.getElementById('customLinkName');
    const urlInput = document.getElementById('customLinkUrl');
    const iconInput = document.getElementById('customLinkIcon');

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

function addPlatformLink() {
    const handleInput = document.getElementById('platformHandle');
    const nameInput = document.getElementById('platformLinkName');
    const preset = getPlatformPreset(selectedPlatformId) || PLATFORM_PRESETS[0];

    const handle = handleInput?.value?.trim();
    const name = nameInput?.value?.trim();

    if (!preset) {
        alert('플랫폼을 선택할 수 없습니다.');
        return;
    }

    if (!handle || !name) {
        alert('플랫폼 링크의 고유 아이디와 이름을 모두 입력하세요.');
        return;
    }

    const url = buildPlatformUrl(preset, handle);

    adminLinks.push({ name, url, platformId: preset.id, handle });
    renderAdminLinks();

    if (handleInput) handleInput.value = '';
    if (nameInput) nameInput.value = '';
}

function addLink() {
    return addCustomLink();
}

// 관리자 페이지: 링크 수정/삭제
function updateAdminLink(index, field, value) {
    const target = adminLinks[index];
    if (!target) return;

    const platformInfo = inferPlatformFromLink(target);

    if (platformInfo) {
        const { preset } = platformInfo;

        if (field === 'handle') {
            const handle = value;
            const computedUrl = /^https?:\/\//i.test(handle)
                ? handle
                : buildPlatformUrl(preset, handle);
            adminLinks[index] = {
                ...target,
                handle,
                platformId: preset.id,
                url: computedUrl,
            };
            renderAdminLinks();
            return;
        }

        if (field === 'url') {
            adminLinks[index] = { ...target, url: value, platformId: undefined, handle: undefined };
            renderAdminLinks();
            return;
        }
    }

    adminLinks[index] = { ...target, [field]: value };
}

function removeLink(index) {
    adminLinks.splice(index, 1);
    renderAdminLinks();
}

function moveLink(index, direction) {
    const targetIndex = typeof direction === 'number' ? index + direction : direction;
    reorderList(adminLinks, index, targetIndex);
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
    window.location.href = "/page-admin-login.html";  // 로그인 페이지로 리디렉션
}

function renderUserLinks(links) {
    const linksList = document.getElementById('links-list');
    if (!linksList || !Array.isArray(links)) return;

    linksList.classList.add('link-stack');
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

        attachDragHandlers(li, index, 'admin-links');

        const header = document.createElement('div');
        header.className = 'link-row-header';

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

        const platformInfo = inferPlatformFromLink(link);

        const meta = document.createElement('div');
        meta.className = 'link-row-meta';

        const iconEl = platformInfo?.preset
            ? createLinkIcon(platformInfo.preset)
            : createCustomIcon(link.iconUrl, link.name || '아이콘') || (() => {
                const fallback = document.createElement('span');
                fallback.className = 'link-icon platform-icon-fallback';
                fallback.innerText = '🔗';
                return fallback;
            })();

        if (iconEl) meta.appendChild(iconEl);

        const metaLabel = document.createElement('span');
        metaLabel.innerText = platformInfo?.preset?.label || link.name || '링크';
        meta.appendChild(metaLabel);

        header.appendChild(reorder);
        header.appendChild(meta);

        const fields = document.createElement('div');
        fields.className = 'link-row-fields';

        const nameInput = document.createElement('input');
        nameInput.placeholder = '링크 이름';
        nameInput.value = link.name || '';
        nameInput.oninput = (e) => updateAdminLink(index, 'name', e.target.value);
        fields.appendChild(nameInput);

        if (platformInfo) {
            const handleInput = document.createElement('input');
            handleInput.placeholder = platformInfo.preset.placeholder || '링크 URL 또는 아이디';
            const currentHandle = link.handle || platformInfo.handle || link.url || '';
            handleInput.value = currentHandle;
            handleInput.oninput = (e) => updateAdminLink(index, 'handle', e.target.value);

            adminLinks[index] = {
                ...link,
                platformId: platformInfo.preset.id,
                handle: currentHandle,
                url: /^https?:\/\//i.test(currentHandle)
                    ? currentHandle
                    : buildPlatformUrl(platformInfo.preset, currentHandle),
            };

            fields.appendChild(handleInput);
        } else {
            const urlInput = document.createElement('input');
            urlInput.placeholder = '링크 URL';
            urlInput.value = link.url || '';
            urlInput.oninput = (e) => updateAdminLink(index, 'url', e.target.value);

            const iconInput = document.createElement('input');
            iconInput.placeholder = '아이콘 URL (선택)';
            iconInput.value = link.iconUrl || '';
            iconInput.oninput = (e) => updateAdminLink(index, 'iconUrl', e.target.value);

            fields.appendChild(urlInput);
            fields.appendChild(iconInput);
        }

        const actions = document.createElement('div');
        actions.className = 'link-row-actions';

        const previewLink = document.createElement('a');
        previewLink.href = link.url || '#';
        previewLink.target = '_blank';
        previewLink.rel = 'noopener';
        previewLink.innerText = '미리보기';

        const saveBtn = document.createElement('button');
        saveBtn.type = 'button';
        saveBtn.className = 'pill-button secondary';
        saveBtn.innerText = '저장';
        saveBtn.onclick = () => savePage();

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'pill-button danger';
        removeBtn.innerText = '삭제';
        removeBtn.onclick = () => removeLink(index);

        actions.appendChild(previewLink);
        actions.appendChild(saveBtn);
        actions.appendChild(removeBtn);

        li.appendChild(header);
        li.appendChild(fields);
        li.appendChild(actions);
        adminList.appendChild(li);
    });
}
