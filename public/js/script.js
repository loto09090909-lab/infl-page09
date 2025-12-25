/**
 * [0] 즉시 실행 보안 로직
 */
(function checkAuth() {
    const isPageAdmin = document.body?.dataset?.pageRole === 'page-admin';
    if (isPageAdmin) {
        const token = sessionStorage.getItem('page_admin_token');
        if (!token) {
            const pid = new URLSearchParams(window.location.search).get('pageId') || "";
            window.location.replace(`/page-admin-login.html${pid ? '?pageId=' + pid : ''}`);
        }
    }
})();

/**
 * [1] 전역 설정 및 상태 변수 (딱 한 번만 선언)
 */
window.APP_CONFIG = window.APP_CONFIG || {};
const APP_CONFIG = window.APP_CONFIG;

const PlatformHelpers = window.PlatformHelpers || {};
const PLATFORM_PRESETS = PlatformHelpers.PLATFORM_PRESETS || [];

function resolveApiBases() {
    const bases = [];
    const pushBase = (value) => {
        if (!value) return;
        const normalized = String(value).trim().replace(/\/+$/, '');
        if (!normalized || normalized.includes('.pages.dev')) return;
        if (!bases.includes(normalized)) {
            bases.push(normalized);
        }
    };
    const pushPreferredBase = (value) => {
        if (!value) return;
        const normalized = String(value).trim().replace(/\/+$/, '');
        if (!normalized || normalized.includes('.pages.dev')) return;
        const existingIndex = bases.indexOf(normalized);
        if (existingIndex !== -1) {
            bases.splice(existingIndex, 1);
        }
        bases.unshift(normalized);
    };

    if (typeof APP_CONFIG.apiBase === 'string') {
        pushBase(APP_CONFIG.apiBase);
    }

    (APP_CONFIG.apiBases || []).forEach((base) => pushBase(base));

    if (APP_CONFIG.preferredApiBase) {
        pushPreferredBase(APP_CONFIG.preferredApiBase);
    }

    if (APP_CONFIG.useMetaApiBase !== false) {
        const metaApiBase = document.querySelector('meta[name="api-base"]')?.content?.trim();
        pushBase(metaApiBase);
    }

    if (APP_CONFIG.useGlobalApiBase !== false) {
        pushBase(window.API_BASE);
    }

    if (APP_CONFIG.useCurrentOriginBase !== false) {
        pushBase(window.location?.origin);
    }

    if (APP_CONFIG.useKnownWorkerBase !== false) {
        pushBase(APP_CONFIG.knownWorkerBase);
    }

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

function setAuthStatus(elementId, message, tone = 'info') {
    const statusEl = document.getElementById(elementId);
    if (!statusEl) return false;
    
    statusEl.textContent = message;
    statusEl.className = `status-banner ${tone}`;
    statusEl.style.display = message ? 'block' : 'none';
    
    return true;
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (error) {
    return false;
  }
}

function createCustomIcon(url, alt = '') {
    if (!url) return null;

    const iconEl = document.createElement('img');
    iconEl.src = url;
    iconEl.alt = alt;
    iconEl.className = 'custom-icon-preview'; // Or some other appropriate class
    iconEl.onerror = () => iconEl.remove();
    return iconEl;
}

function ensureUserViewContainer() {
    if (document.getElementById('user-view-container')) return;

    const container = document.createElement('div');
    container.id = 'user-view-container';
    
    container.innerHTML = `
        <main class="user-shell">
            <section class="user-card">
                <header class="user-header">
                    <h1 id="user-page-name"></h1>
                    <span id="env-badge" class="env-badge" aria-live="polite" style="display: none;"></span>
                </header>
                <div class="profile user-profile">
                    <img src="" alt="" class="profile-photo user-avatar" id="user-page-photo" style="display: none;">
                    <p class="profile-description" id="user-page-description"></p>
                </div>
                <section class="links user-links">
                    <h3>링크</h3>
                    <ul id="links-list" class="link-stack">
                    </ul>
                </section>
                <section id="user-contact-section" class="contact" style="display: none;">
                    <h2 id="user-contact-title">문의하기</h2>
                    <p id="user-contact-help" class="help-text"></p>
                    <form id="user-contact-form" onsubmit="submitContactForm(event)">
                        <div id="user-contact-fields"></div>
                        <button id="user-contact-submit" type="submit">제출</button>
                    </form>
                    <div id="user-contact-status"></div>
                </section>
                <footer class="user-footer">
                    <p>&copy; 2025 인플루언서 페이지</p>
                </footer>
            </section>
        </main>
    `;
    document.body.appendChild(container);
}

function slugify(value) {
    if (!value) return '';
    const normalized = value.toString().toLowerCase();

    const separated = normalized
        .replace(/[^a-z0-9 -]+/g, '-')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-');

    const cleaned = separated.replace(/^-+|-+$/g, '');

    return cleaned;
}

const buildPlatformUrl = PlatformHelpers.buildPlatformUrl || function (preset, handle) {
    const cleanHandle = (handle || '').trim().replace(/^\/+/, '');
    return cleanHandle ? `${preset.baseUrl}${cleanHandle}` : '';
};

const inferPlatformFromLink = PlatformHelpers.inferPlatformFromLink || function (link) {
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

function createLinkIcon(preset, className = 'platform-icon') {
    if (!preset) return null;

    if (!preset.iconPath) {
        const fallbackIcon = document.createElement('span');
        fallbackIcon.className = `${className} platform-icon-fallback`;
        fallbackIcon.innerText = preset.emoji || '🔗';
        return fallbackIcon;
    }

    const iconEl = document.createElement('img');
    iconEl.src = preset.iconPath || '';
    iconEl.alt = preset.label || '';
    iconEl.className = className;
    iconEl.onerror = () => {
        const fallback = document.createElement('span');
        fallback.className = `${className} platform-icon-fallback`;
        fallback.innerText = preset.emoji || '🔗';
        iconEl.replaceWith(fallback);
    };

    return iconEl;
}

const urlParams = new URLSearchParams(window.location.search);

/**
 * [2] 페이지 컨텍스트 및 라우팅 변수
 */
const pathSegments = window.location.pathname.split('/').filter(Boolean);
const searchParams = new URLSearchParams(window.location.search);
const pageRole = document.body?.dataset?.pageRole; // 'page-admin', 'super-admin' 등

// 페이지 종류 식별
const isAdminLogin = window.location.pathname.endsWith('/login.html');
const isPageAdminLogin = window.location.pathname.endsWith('/page-admin-login.html');
const isAdminHtml = window.location.pathname.endsWith('/admin.html');
const isSuperAdminHtml = window.location.pathname.endsWith('/super-admin.html');

const isUserPage = pathSegments.length === 2 && pathSegments[0] === 'user';
const privateTokenFromPath = pathSegments.length === 3 && pathSegments[1] === 'private' ? pathSegments[2] : null;
const isPrivateLink = !!privateTokenFromPath;

const looksLikeSlugPage = pathSegments.length === 1 && !isAdminHtml && !isUserPage && !isPrivateLink && !isSuperAdminHtml && !isAdminLogin && !isPageAdminLogin;

const isPublicView = looksLikeSlugPage || isPrivateLink || isUserPage || document.body.classList.contains('user-view');

const pageIdFromQuery = searchParams.get('pageId');
const pageIdFromPath = looksLikeSlugPage || isPrivateLink ? pathSegments[0] : null;

let derivedPageId = pageIdFromQuery || pageIdFromPath; // Make it 'let'

let userViewReady = document.getElementById('user-view-container');


function formatStatusWithRequestId(message, res) {
    if (!res || typeof res.headers?.get !== 'function') return message;
    const requestId = res.headers.get('X-Request-Id');
    return requestId ? `${message} (요청 ID: ${requestId})` : message;
}

const getPlatformPreset = PlatformHelpers.getPlatformPreset || ((platformId) => PLATFORM_PRESETS.find((preset) => preset.id === platformId));

if (isPublicView) {
    document.body.classList.add('user-view');
    document.body.classList.add('theme-scope');
}


let currentUserRole = 'viewer';

// 상태 데이터 변수들
let adminLinks = [];
let adminSlugs = [];
let pagePlan = 'free';
let pageTheme = 'classic';
let pagePlanStatus = {};
let contactSettings = {};
let adminContactSchema = [];
let publicContactSchema = [];
let publicContactSettings = {};
let contactEnabled = false;
let contactSubmissions = [];
let privateTemplates = [];
let dragState = null;
let currentPageId = '';

const MAX_CONTACT_FIELDS = 20;

const PLAN_LIMITS = {
    free: { max_private_links: 3, max_contact_fields: 3 },
    basic: { max_private_links: 10, max_contact_fields: 10 },
    premium: { max_private_links: 100, max_contact_fields: 25 },
};

const THEME_PRESETS = [
    { id: 'classic', label: '클래식', desc: '밝은 기본 스타일', swatch: ['#f7f7fb', '#ffffff', '#16a34a', '#0f172a'] },
    { id: 'midnight', label: '미드나잇', desc: '어두운 배경 + 하늘색 포인트', swatch: ['#0b1220', '#0f172a', '#22d3ee', '#e5e7eb'] },
    { id: 'sunset', label: '선셋', desc: '따뜻한 주황/살구 톤', swatch: ['#fff7ed', '#fef3c7', '#f97316', '#7c2d12'] },
    { id: 'mint', label: '민트', desc: '시원한 민트/틸 포인트', swatch: ['#ecfeff', '#f0fdfa', '#14b8a6', '#042f2e'] },
];

const CONTACT_PRESETS = [
    { label: '간단 문의', fields: [{ label: '이메일', type: 'email', required: true }, { label: '문의 내용', type: 'textarea', required: true }] },
    { label: '견적 요청', fields: [{ label: '회사명', type: 'text' }, { label: '담당자', type: 'text', required: true }, { label: '연락처', type: 'tel', required: true }, { label: '예산', type: 'text' }, { label: '내용', type: 'textarea' }] },
    { label: '방송 출연 제안', fields: [{ label: '프로그램명', type: 'text' }, { label: '방송사', type: 'text' }, { label: '담당자/연락처', type: 'text', required: true }, { label: '제안 내용', type: 'textarea' }] },
];

function updatePageContext(pageId) {
    derivedPageId = pageId;
    currentPageId = pageId;
    const pageLink = document.getElementById('public-link');
    const slugBadge = document.getElementById('current-slug-badge');
    const idBadge = document.getElementById('current-page-id');

    if (idBadge) idBadge.innerText = pageId;

    if (pageLink) {
        const slug = adminSlugs?.[0] || pageId;
        pageLink.href = `/${slug}`;
    }

    if (slugBadge) {
        slugBadge.innerText = `슬러그: ${adminSlugs?.[0] || '-'}`;
    }
}

async function loadPageData(pageId, options = {}) {
    if (!pageId) return;

    currentPageId = pageId;
    const { includeAdmin, privateToken } = options;
    const adminQuery = includeAdmin ? '?admin=true' : '';
    const privateQuery = privateToken ? `?token=${privateToken}` : '';
    const endpoint = privateToken
        ? `/api/page/${pageId}/private${privateQuery}`
        : `/api/page/${pageId}${adminQuery}`;

    try {
        const res = await apiFetch(endpoint);
        if (!res.ok) {
            console.error('페이지 데이터 로드 실패', res.status);
            return;
        }

        const data = await res.json();

        // 프로필 정보 채우기
        const profileName = document.getElementById('user-page-name') || document.getElementById('name');
        const profileDesc = document.getElementById('user-page-description') || document.getElementById('desc');
        const profilePhoto = document.getElementById('user-page-photo') || document.getElementById('photo');
        const adminTitle = document.getElementById('admin-page-title');

        if (profileName) profileName.innerText = data.profile?.name || '';
        if (profileDesc) profileDesc.innerText = data.profile?.description || '';
        if (profilePhoto) {
            if (data.profile?.photoUrl) {
                profilePhoto.src = data.profile.photoUrl;
                profilePhoto.style.display = 'block';
            } else {
                profilePhoto.style.display = 'none';
            }
        }
        
        if (includeAdmin) {
            if (document.getElementById('name')) document.getElementById('name').value = data.profile?.name || '';
            if (document.getElementById('desc')) document.getElementById('desc').value = data.profile?.description || '';
            if (document.getElementById('photo')) document.getElementById('photo').value = data.profile?.photoUrl || '';
            if (adminTitle) adminTitle.innerText = data.profile?.name || '페이지 관리';

            adminLinks = [...(data.links || []), ...(data.privateLinks || [])];
            pagePlan = data.plan || 'free';
            pageTheme = data.theme || 'classic';
            pagePlanStatus = data.planStatus || {};
            adminSlugs = Array.isArray(data.slugs) && data.slugs.length ? data.slugs : [slugify(pageId)];
            contactSettings = data.contactSettings || {};
            adminContactSchema = data.contactSchema || [];
            
            renderAdminLinks();
            renderSlugEditor();
            hydrateContactSettings();
            renderContactSchemaEditor();
            renderThemeOptions();
            renderUsage();
            updatePageContext(pageId);
        } else {
            renderUserLinks(data.links || []);
            pageTheme = data.theme || 'classic';
            publicContactSchema = data.contactSchema || [];
            publicContactSettings = data.contactSettings || {};
            contactEnabled = publicContactSettings.enabled === true;
            renderPublicContactForm();
        }

        applyThemeToScopes();

    } catch (error) {
        console.error('페이지 데이터 처리 중 오류', error);
    }
}

async function ensurePageSession() {
    if (pageRole !== 'page-admin' || !derivedPageId) return;

    const token = sessionStorage.getItem('page_admin_token');
    if (!token) {
        const redirectTarget = `/page-admin-login.html?pageId=${encodeURIComponent(derivedPageId)}`;
        window.location.href = redirectTarget;
        return;
    }

    try {
        const res = await apiFetch(`/api/page/${encodeURIComponent(derivedPageId)}/session`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}` },
        });

        if (!res.ok) {
            sessionStorage.removeItem('page_admin_token');
            const message = await res.text();
            setPageLoginStatus(`세션이 만료되었습니다: ${message || res.status}`, 'error');
            window.location.href = `/page-admin-login.html?pageId=${encodeURIComponent(derivedPageId)}`;
            return;
        }

        const payload = await res.json().catch(() => null);
        if (payload) {
            if (payload.pageId && payload.pageId !== derivedPageId) {
                updatePageContext(payload.pageId);
            }
            currentUserRole = payload.role || 'viewer';
            applyRolePermissions();
        }
    } catch (error) {
        console.error('세션 확인 중 오류', error);
    }
}

function applyRolePermissions() {
    const body = document.body;
    body.classList.remove('role-owner', 'role-editor', 'role-viewer', 'role-super');
    
    const role = currentUserRole || 'viewer';
    body.classList.add(`role-${role}`);
}

if (pageRole === 'page-admin' && derivedPageId) {
    updatePageContext(derivedPageId);
}

if ((looksLikeSlugPage || isPrivateLink) && !userViewReady && !pageRole) {
    ensureUserViewContainer();
    userViewReady = document.getElementById('user-view-container');
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

    ensurePageSession();
}

if (userViewReady || pageRole === 'page-admin') {
    if (isUserPage) {
        const pageId = pathSegments[1];
        loadPageData(pageId, { includeAdmin: pageRole === 'page-admin' });
    } else if (isPrivateLink) {
        loadPageData(pathSegments[0], { privateToken: privateTokenFromPath });
    } else if (looksLikeSlugPage) {
        loadPageData(pathSegments[0], { includeAdmin: pageRole === 'page-admin' });
    } else if (isAdminHtml && pageIdFromQuery) {
        loadPageData(pageIdFromQuery, { includeAdmin: pageRole === 'page-admin' });
    } else if (pageRole === 'page-admin' && derivedPageId) {
        loadPageData(derivedPageId, { includeAdmin: true });
    } else {
        console.debug('사용자 페이지가 아니므로 페이지 데이터를 로드를 건너뜁니다.');
    }
} else {
    console.debug('사용자 페이지 컨테이너가 없어 페이지 데이터를 요청하지 않습니다.');
}

// 페이지 관리자 로그인 화면에서 URL로 받은 pageId를 자동 입력
document.addEventListener('DOMContentLoaded', () => {
    renderThemeOptions();
    consumeOAuthTokenFromQuery();
    if (window.location.pathname.endsWith('/user-dashboard.html') || window.location.pathname.endsWith('/dashboard')) {
        refreshUserDashboard();
    }

    const pageAdminIdInput = document.getElementById('page-admin-id');
    if (pageAdminIdInput && (pageIdFromPath || pageIdFromQuery)) {
        pageAdminIdInput.value = pageIdFromPath || pageIdFromQuery;
    }

    if (document.body?.dataset?.pageRole === 'page-admin') {
        renderPlatformSelector();
        updatePlatformPrefix();
        renderContactPresets();
        renderSlugEditor();

        const primarySlugInput = document.getElementById('primary-slug-input');
        if (primarySlugInput) {
            primarySlugInput.addEventListener('change', (e) => setPrimarySlug(e.target.value));
            primarySlugInput.addEventListener('blur', (e) => setPrimarySlug(e.target.value));
        }
        renderOnboardingBanner();

        const newFieldForm = document.getElementById('new-contact-field-form');
        if (newFieldForm) {
            newFieldForm.addEventListener('submit', (e) => {
                e.preventDefault();
                const labelInput = document.getElementById('new-field-label');
                const typeInput = document.getElementById('new-field-type');
                const label = labelInput.value.trim();
                const type = typeInput.value;
                if (label && type) {
                    adminContactSchema.push({ label, type, required: false });
                    renderContactSchemaEditor();
                    labelInput.value = '';
                }
            });
        }
    }
});

// 관리자 페이지: 페이지 저장
async function savePage() {
    const statusBox = document.getElementById('save-status');
    const setStatus = (message, tone = 'info') => {
        if (!statusBox) return;
        statusBox.innerText = message;
        statusBox.dataset.tone = tone;
        statusBox.style.display = message ? 'block' : 'none';
    };

    setStatus('변경 사항을 검증하는 중입니다...', 'info');

    if (!derivedPageId) {
        setStatus('페이지 식별자가 없어 저장할 수 없습니다. URL을 확인해주세요.', 'error');
        return;
    }

    const token = sessionStorage.getItem('page_admin_token');
    if (!token) {
        setStatus('페이지 관리자 로그인이 필요합니다. 다시 로그인 해주세요.', 'error');
        return;
    }

    const name = document.getElementById('name')?.value?.trim() || '';
    const desc = document.getElementById('desc')?.value?.trim() || '';
    const photo = document.getElementById('photo')?.value?.trim() || '';

    const linkErrors = [];
    adminLinks.forEach((link, idx) => {
        const title = (link.title || link.name || '').trim();
        const url = (link.url || '').trim();
        if (!title || !url) {
            linkErrors.push(`${idx + 1}번째 링크에 이름/URL이 없습니다.`);
            return;
        }
        if (!isHttpUrl(url)) {
            linkErrors.push(`${idx + 1}번째 링크 URL이 http(s) 형식이 아닙니다.`);
        }
        if (link.iconUrl && !isHttpUrl(link.iconUrl)) {
            linkErrors.push(`${idx + 1}번째 링크 아이콘 URL이 잘못되었습니다.`);
        }
    });

    if (linkErrors.length) {
        setStatus(linkErrors.join(' '), 'error');
        return;
    }

    if (adminContactSchema.length > MAX_CONTACT_FIELDS) {
        setStatus(`컨택트 필드는 최대 ${MAX_CONTACT_FIELDS}개까지만 추가할 수 있습니다.`, 'error');
        return;
    }

    const { publicLinks, privateLinks } = splitAdminLinks();
    const formattedPublic = publicLinks.map((link) => ({
        title: (link.title || link.name || '').trim(),
        url: (link.url || '').trim(),
        ...(link.iconUrl ? { iconUrl: link.iconUrl.trim() } : {}),
        ...(link.platformId ? { platformId: link.platformId } : {}),
        ...(link.handle ? { handle: link.handle } : {}),
    }));

    const formattedPrivate = privateLinks.map((link) => ({
        title: (link.title || link.name || '').trim(),
        url: (link.url || '').trim(),
        isPrivate: true,
        ...(link.iconUrl ? { iconUrl: link.iconUrl.trim() } : {}),
        ...(link.platformId ? { platformId: link.platformId } : {}),
        ...(link.handle ? { handle: link.handle } : {}),
    }));

    const enabledContact = contactSettings.enabled === true;

    const payload = {
        profile: { name, description: desc, photoUrl: photo },
        links: formattedPublic,
        privateLinks: formattedPrivate,
        contactSchema: adminContactSchema.map((field) => ({
            label: (field.label || '').trim(),
            type: field.type || 'text',
            ...(field.placeholder ? { placeholder: field.placeholder } : {}),
            ...(field.helpText ? { helpText: field.helpText } : {}),
            ...(field.required ? { required: true } : {}),
            ...(Array.isArray(field.options) && field.options.length
                ? { options: field.options.filter(Boolean).map((item) => (item || '').trim()).filter(Boolean) }
                : {}),
        })),
        contactSettings: {
            enabled: enabledContact,
            ...(contactSettings && contactSettings.webhookUrl
                ? { webhookUrl: contactSettings.webhookUrl.trim() } 
                : {}),
            ...(Array.isArray(contactSettings.webhookUrls) && contactSettings.webhookUrls.length
                ? { webhookUrls: contactSettings.webhookUrls } 
                : {}),
            ...(Array.isArray(contactSettings.emailRecipients) && contactSettings.emailRecipients.length
                ? { emailRecipients: contactSettings.emailRecipients } 
                : {}),
            ...(contactSettings.emailSubject ? { emailSubject: contactSettings.emailSubject.trim() } : {}),
            ...(contactSettings.formTitle ? { formTitle: contactSettings.formTitle.trim() } : {}),
            ...(contactSettings.formDescription ? { formDescription: contactSettings.formDescription.trim() } : {}),
            ...(contactSettings.consentText ? { consentText: contactSettings.consentText.trim() } : {}),
            ...(contactSettings.consentRequired ? { consentRequired: true } : {}),
        },
        slugs: adminSlugs,
        plan: pagePlan,
        theme: pageTheme,
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
        setStatus('페이지가 저장되었습니다.', 'success');
    } else {
        const errText = await res.text();
        setStatus(`저장 실패: ${errText || res.status}`, 'error');
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

    adminLinks.push({ title: name, url, iconUrl });
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

    adminLinks.push({ title: name, url, platformId: preset.id, handle });
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

    if (field === 'isPrivate') {
        adminLinks[index] = { ...target, isPrivate: !!value };
        renderAdminLinks();
        return;
    }

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
        if (!setAuthStatus('super-login-status', '아이디와 비밀번호를 모두 입력하세요.', 'error')) {
            alert('아이디와 비밀번호를 모두 입력하세요.');
        }
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
        const message = formatStatusWithRequestId(`로그인 실패: ${errText || res.status}`, res);
        if (!setAuthStatus('super-login-status', message, 'error')) {
            alert(message);
        }
    }
}

function storeUserSession(token, expiresIn) {
    if (!token) return;
    sessionStorage.setItem('user_token', token);
    if (expiresIn) {
        const expiresAt = Date.now() + Number(expiresIn) * 1000;
        sessionStorage.setItem('user_token_expires_at', expiresAt.toString());
    }
}

async function fetchUserPrimaryPage() {
    const token = sessionStorage.getItem('user_token');
    if (!token) return null;

    const res = await apiFetch('/api/user/pages', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
    }, [401, 403, 404]);

    if (!res.ok) return null;
    const payload = await res.json().catch(() => null);
    const items = Array.isArray(payload?.items) ? payload.items : [];
    return items[0]?.pageId || null;
}

async function fetchUserPages() {
    const token = sessionStorage.getItem('user_token');
    if (!token) {
        setAuthStatus('user-dashboard-status', '로그인이 필요합니다.', 'error');
        return [];
    }

    const res = await apiFetch('/api/user/pages', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
    }, [401, 403, 404]);

    if (!res.ok) {
        const msg = await res.text().catch(() => '');
        setAuthStatus(
            'user-dashboard-status',
            formatStatusWithRequestId(`페이지 목록을 불러오지 못했습니다: ${msg || res.status}`, res),
            'error'
        );
        return [];
    }
    setAuthStatus('user-dashboard-status', '', 'info');
    const payload = await res.json().catch(() => null);
    return Array.isArray(payload?.items) ? payload.items : [];
}

function renderUserPagesDashboard(items) {
    const list = document.getElementById('user-pages-list');
    if (!list) return;
    list.innerHTML = '';

    if (!items.length) {
        const empty = document.createElement('li');
        empty.className = 'empty';
        empty.innerText = '아직 생성된 페이지가 없습니다.';
        list.appendChild(empty);
        return;
    }

    items.forEach((item) => {
        const row = document.createElement('li');
        row.className = 'link-item';

        const info = document.createElement('div');
        info.className = 'link-info';
        info.innerHTML = `<strong>${item.pageId}</strong><div class="muted">${item.profile?.name || ''}</div>`;
        row.appendChild(info);

        const actions = document.createElement('div');
        actions.className = 'link-actions';
        const manageBtn = document.createElement('button');
        manageBtn.type = 'button';
        manageBtn.className = 'secondary';
        manageBtn.innerText = '관리';
        manageBtn.onclick = () => {
            window.location.href = `/page-admin-login.html?pageId=${encodeURIComponent(item.pageId)}`;
        };
        actions.appendChild(manageBtn);
        row.appendChild(actions);
        list.appendChild(row);
    });
}

async function refreshUserDashboard() {
    const list = document.getElementById('user-pages-list');
    if (!list) return;

    const token = sessionStorage.getItem('user_token');
    if (!token) {
        setAuthStatus('user-dashboard-status', '로그인이 필요합니다.', 'error');
        window.location.href = '/user-login';
        return;
    }

    const items = await fetchUserPages();
    renderUserPagesDashboard(items);
}

function userLogout() {
    sessionStorage.removeItem('user_token');
    sessionStorage.removeItem('user_token_expires_at');
    window.location.href = '/user-login';
}

async function userSignup() {
    const emailInput = document.getElementById('user-signup-email');
    const passwordInput = document.getElementById('user-signup-password');
    const email = emailInput ? emailInput.value.trim() : '';
    const password = passwordInput ? passwordInput.value : '';

    if (!email || !password) {
        if (!setAuthStatus('user-signup-status', '이메일과 비밀번호를 입력하세요.', 'error')) {
            alert('이메일과 비밀번호를 입력하세요.');
        }
        return;
    }

    const res = await apiFetch('/api/users/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
    }, [400, 401, 409, 422]);

    if (!res.ok) {
        const msg = await res.text();
        const message = formatStatusWithRequestId(`회원가입 실패: ${msg || res.status}`, res);
        if (!setAuthStatus('user-signup-status', message, 'error')) {
            alert(message);
        }
        return;
    }

    const payload = await res.json().catch(() => null);
    storeUserSession(payload?.token, payload?.expiresIn);

    const pageId = payload?.pageId;
    window.location.href = '/dashboard';
}

async function userLogin() {
    const emailInput = document.getElementById('user-login-email');
    const passwordInput = document.getElementById('user-login-password');
    const email = emailInput ? emailInput.value.trim() : '';
    const password = passwordInput ? passwordInput.value : '';

    if (!email || !password) {
        if (!setAuthStatus('user-login-status', '이메일과 비밀번호를 입력하세요.', 'error')) {
            alert('이메일과 비밀번호를 입력하세요.');
        }
        return;
    }

    const res = await apiFetch('/api/users/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
    }, [400, 401, 404, 423]);

    if (!res.ok) {
        const msg = await res.text();
        const message = formatStatusWithRequestId(`로그인 실패: ${msg || res.status}`, res);
        if (!setAuthStatus('user-login-status', message, 'error')) {
            alert(message);
        }
        return;
    }

    const payload = await res.json().catch(() => null);
    storeUserSession(payload?.token, payload?.expiresIn);

    window.location.href = '/dashboard';
}

function startOAuth(provider) {
    const redirect = `${window.location.origin}/dashboard`;
    getApiBase().then((base) => {
        if (!base) {
            alert('API 베이스를 찾지 못했습니다.');
            return;
        }
        const url = `${base}/api/auth/${encodeURIComponent(provider)}/start?redirect=${encodeURIComponent(redirect)}`;
        window.location.href = url;
    });
}

async function consumeOAuthTokenFromQuery() {
    const token = searchParams.get('token');
    const expiresIn = searchParams.get('expiresIn');
    if (!token) return;

    storeUserSession(token, expiresIn);
    searchParams.delete('token');
    searchParams.delete('expiresIn');
    const nextUrl = `${window.location.pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;
    window.history.replaceState({}, '', nextUrl);

    window.location.href = '/dashboard';
}

async function logoutSuperAdmin() {
    const token = sessionStorage.getItem('super_admin_token');

    if (token) {
        try {
            await apiFetch('/api/admin/logout', {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
            }, [401]);
        } catch (error) {
            console.warn('슈퍼 관리자 로그아웃 요청 실패', error);
        }
    }

    sessionStorage.removeItem('super_admin_token');
    window.location.href = '/login.html';
}

async function bootstrapSuperAdmin() {
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const username = usernameInput && usernameInput.value ? usernameInput.value : 'admin';
    const password = passwordInput ? passwordInput.value : '';

    if (!username || !password) {
        if (!setAuthStatus('super-login-status', '아이디와 비밀번호를 모두 입력하세요.', 'error')) {
            alert('아이디와 비밀번호를 모두 입력하세요.');
        }
        return;
    }

    const token = sessionStorage.getItem('super_admin_token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await apiFetch('/api/admin/bootstrap', {
        method: 'POST',
        headers,
        body: JSON.stringify({ username, password })
    }, [400, 401, 404, 405]);

    if (res.ok) {
        const payload = await res.json().catch(() => ({}));
        if (!setAuthStatus(
            'super-login-status',
            `계정을 준비했습니다: ${payload.username || username} (${payload.mode || 'created'})`,
            'success'
        )) {
            alert(`계정을 준비했습니다: ${payload.username || username} (${payload.mode || 'created'})`);
        }
    } else {
        const errText = await res.text();
        const message = formatStatusWithRequestId(
            `계정 생성/재설정 실패: ${errText || res.status}`,
            res
        );
        if (!setAuthStatus('super-login-status', message, 'error')) {
            alert(message);
        }
    }
}

const PBKDF2_ITERATIONS = 120000;
const PBKDF2_KEY_LENGTH = 32; // bytes

function bufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary);
}

async function pbkdf2Hash(password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const encodedPassword = new TextEncoder().encode(password);
    const key = await crypto.subtle.importKey('raw', encodedPassword, 'PBKDF2', false, ['deriveBits']);
    const derivedBits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
        key,
        PBKDF2_KEY_LENGTH * 8
    );

    const saltB64 = bufferToBase64(salt.buffer);
    const hashB64 = bufferToBase64(derivedBits);
    return `pbkdf2$${PBKDF2_ITERATIONS}$${saltB64}$${hashB64}`;
}

async function showD1SeedSql() {
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const snippetEl = document.getElementById('d1-seed-snippet');

    const username = usernameInput && usernameInput.value ? usernameInput.value : 'admin';
    const password = passwordInput ? passwordInput.value : '';

    if (!password) {
        alert('비밀번호를 입력하면 D1 시드 SQL을 생성합니다.');
        return;
    }

    const hash = await pbkdf2Hash(password);
    const escapedUsername = username.replace(/'/g, "''");
    const sql = `INSERT OR REPLACE INTO super_admins (username, password_hash)\nVALUES ('${escapedUsername}', '${hash}');`;

    if (snippetEl) {
        snippetEl.textContent = sql;
    }

    return sql;
}

// 인플루언서 페이지 관리자 로그인
async function pageAdminLogin() {
    const emailInput = document.getElementById('page-admin-email');
    const passwordInput = document.getElementById('page-admin-password');
    const email = emailInput ? emailInput.value.trim() : '';
    const password = passwordInput ? passwordInput.value : '';
    const inputPageIdEl = document.getElementById('page-admin-id');
    const pageIdFromInput = inputPageIdEl ? inputPageIdEl.value : '';
    const pageIdFromPath =
        pathSegments.length >= 2 && pathSegments[1] === 'admin' ? pathSegments[0] : '';
    const pageId = pageIdFromPath || pageIdFromInput;

    setPageLoginStatus('', 'info');

    if (!pageId || pageId === 'admin') {
        setPageLoginStatus('페이지 식별자가 없어 로그인할 수 없습니다. URL에 /{pageId}/admin 형식으로 접속하거나 페이지 ID를 입력하세요.', 'error');
        return;
    }

    if (!email) {
        setPageLoginStatus('관리자 이메일을 입력하세요.', 'error');
        return;
    }

    if (!password) {
        setPageLoginStatus('비밀번호를 입력하세요.', 'error');
        return;
    }

    setPageLoginStatus('로그인 중입니다...', 'info');

    const res = await apiFetch(`/api/page/${encodeURIComponent(pageId)}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
    });

    if (res.ok) {
        const session = await res.json();
        sessionStorage.setItem('page_admin_token', session.token);
        setPageLoginStatus('로그인에 성공했습니다. 잠시 후 이동합니다.', 'success');
        window.location.href = `/admin.html?pageId=${encodeURIComponent(pageId)}`;
    } else {
        const message = await res.text();
        setPageLoginStatus(`로그인 실패: ${message || res.status}`, 'error');
    }
}

// 로그아웃 함수
async function logout() {
    const token = sessionStorage.getItem('page_admin_token');
    const redirectTarget = derivedPageId
        ? `/page-admin-login.html?pageId=${encodeURIComponent(derivedPageId)}` 
        : '/page-admin-login.html';

    if (token && derivedPageId) {
        try {
            await apiFetch(`/api/page/${encodeURIComponent(derivedPageId)}/logout`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
            }, [401]);
        } catch (error) {
            console.warn('페이지 관리자 로그아웃 요청 실패', error);
        }
    }

    sessionStorage.removeItem('page_admin_token');
    document.cookie = "session=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/";  // 세션 쿠키 삭제
    window.location.href = redirectTarget;  // 로그인 페이지로 리디렉션
}

function renderUserLinks(links) {
    const linksList = document.getElementById('links-list');
    if (!linksList || !Array.isArray(links)) return;

    linksList.classList.add('link-stack');
    linksList.innerHTML = '';
    links.filter((link) => !link?.isPrivate).forEach(link => {
        const li = document.createElement('li');
        const anchor = document.createElement('a');
        anchor.href = link.url || '#';
        anchor.target = '_blank';
        anchor.rel = 'noopener';
        anchor.className = 'link-with-icon';

        const platformInfo = inferPlatformFromLink(link) || (link.platformId ? { preset: getPlatformPreset(link.platformId) } : null);
        const iconEl = platformInfo?.preset
            ? createLinkIcon(platformInfo.preset)
            : createCustomIcon(link.iconUrl, link.title || link.url);

        if (iconEl) anchor.appendChild(iconEl);

        const label = document.createElement('span');
        label.innerText = link.title || link.url;
        anchor.appendChild(label);

        li.appendChild(anchor);
        linksList.appendChild(li);
    });
}

function setContactStatus(message, tone = 'info') {
    const statusEl = document.getElementById('user-contact-status');
    if (!statusEl) return;
    if (!message) {
        statusEl.style.display = 'none';
        statusEl.innerText = '';
        return;
    }

    statusEl.style.display = 'block';
    statusEl.className = `status-banner ${tone}`;
    statusEl.innerText = message;
}

function renderPublicContactForm() {
    const section = document.getElementById('user-contact-section');
    const fieldsHost = document.getElementById('user-contact-fields');
    const help = document.getElementById('user-contact-help');
    const title = document.getElementById('user-contact-title');
    const submitBtn = document.getElementById('user-contact-submit');
    const form = document.getElementById('user-contact-form');

    if (!section || !fieldsHost || !help || !submitBtn || !form) return;

    fieldsHost.innerHTML = '';

    if (!contactEnabled) {
        section.style.display = 'none';
        setContactStatus('');
        return;
    }

    section.style.display = 'block';

    if (!publicContactSchema.length) {
        help.innerText = '관리자가 컨택트 필드를 설정하지 않았습니다.';
        form.style.display = 'none';
        return;
    }

    form.style.display = 'block';
    const defaultTitle = '문의하기';
    const defaultHelp = '아래 항목을 입력해 페이지 관리자에게 문의를 전달하세요.';
    if (title) {
        title.innerText = publicContactSettings.formTitle || defaultTitle;
    }
    help.innerText = publicContactSettings.formDescription || defaultHelp;

    publicContactSchema.forEach((field, idx) => {
        const baseId = `user-contact-${idx}`;
        const wrapper = document.createElement('div');
        wrapper.className = 'contact-field';

        const title = document.createElement('label');
        title.className = 'contact-label';
        title.htmlFor = baseId;
        title.innerText = field.label + (field.required ? ' *' : '');
        wrapper.appendChild(title);

        const placeholder = field.placeholder || '';
        const required = !!field.required;
        const options = Array.isArray(field.options) ? field.options : [];
        const type = field.type || 'text';

        if (type === 'textarea') {
            const textarea = document.createElement('textarea');
            textarea.id = baseId;
            textarea.name = field.label;
            textarea.placeholder = placeholder;
            textarea.maxLength = 2000;
            textarea.required = required;
            wrapper.appendChild(textarea);
        } else if (type === 'select' && options.length) {
            const select = document.createElement('select');
            select.id = baseId;
            select.name = field.label;
            select.required = required;

            const empty = document.createElement('option');
            empty.value = '';
            empty.innerText = placeholder || '선택하세요';
            select.appendChild(empty);

            options.forEach((opt) => {
                const option = document.createElement('option');
                option.value = opt;
                option.innerText = opt;
                select.appendChild(option);
            });

            wrapper.appendChild(select);
        } else if (type === 'checkbox' && options.length) {
            const group = document.createElement('div');
            group.className = 'checkbox-group';
            options.forEach((opt, optionIdx) => {
                const itemId = `${baseId}-${optionIdx}`;
                const row = document.createElement('label');
                row.className = 'checkbox-item';

                const input = document.createElement('input');
                input.type = 'checkbox';
                input.name = baseId;
                input.value = opt;
                input.id = itemId;
                row.appendChild(input);

                const span = document.createElement('span');
                span.innerText = opt;
                row.appendChild(span);
                group.appendChild(row);
            });
            if (required) {
                group.dataset.required = 'true';
            }
            wrapper.appendChild(group);
        } else if (type === 'checkbox') {
            const row = document.createElement('label');
            row.className = 'checkbox-item';
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.id = baseId;
            input.name = field.label;
            input.value = 'checked';
            if (required) input.required = true;
            row.appendChild(input);
            const span = document.createElement('span');
            span.innerText = placeholder || '동의/확인';
            row.appendChild(span);
            wrapper.appendChild(row);
        } else {
            const input = document.createElement('input');
            input.id = baseId;
            input.name = field.label;
            input.type = type;
            input.placeholder = placeholder;
            input.maxLength = 2000;
            if (required) input.required = true;
            wrapper.appendChild(input);
        }

        if (field.helpText) {
            const helper = document.createElement('p');
            helper.className = 'help-text';
            helper.innerText = field.helpText;
            wrapper.appendChild(helper);
        }

        fieldsHost.appendChild(wrapper);
    });

    const existingConsent = document.getElementById('user-contact-consent');
    if (existingConsent) {
        existingConsent.remove();
    }
    if (publicContactSettings.consentText || publicContactSettings.consentRequired) {
        const consentWrap = document.createElement('label');
        consentWrap.className = 'checkbox-item';
        consentWrap.id = 'user-contact-consent';
        const consentInput = document.createElement('input');
        consentInput.type = 'checkbox';
        consentInput.id = 'user-contact-consent-input';
        consentInput.required = !!publicContactSettings.consentRequired;
        consentWrap.appendChild(consentInput);
        const consentLabel = document.createElement('span');
        consentLabel.innerText =
            publicContactSettings.consentText || '개인정보 수집/이용에 동의합니다.';
        consentWrap.appendChild(consentLabel);
        fieldsHost.appendChild(consentWrap);
    }

    renderTurnstileWidget();
    setContactStatus('');
    submitBtn.disabled = false;
}

async function submitContactForm(event) {
    event.preventDefault();
    const form = event.target;
    const submitBtn = document.getElementById('user-contact-submit');
    if (!form || !currentPageId || !publicContactSchema.length || !contactEnabled) {
        setContactStatus('제출할 컨택트 폼이 없습니다.', 'warning');
        return;
    }
    const answers = publicContactSchema.map((field, idx) => {
        const baseId = `user-contact-${idx}`;
        const options = Array.isArray(field.options) ? field.options : [];
        let value = '';

        if (field.type === 'checkbox' && options.length) {
            const checked = Array.from(document.querySelectorAll(`input[name="${baseId}"]:checked`));
            value = checked.map((el) => (el.value || '').trim()).filter(Boolean).join(', ');
        } else if (field.type === 'checkbox') {
            const input = document.getElementById(baseId);
            value = input?.checked ? 'checked' : '';
        } else if (field.type === 'select') {
            const select = document.getElementById(baseId);
            value = select?.value?.trim() || '';
        } else if (field.type === 'textarea') {
            const textarea = document.getElementById(baseId);
            value = textarea?.value?.trim() || '';
        } else {
            const input = document.getElementById(baseId);
            value = input?.value?.trim() || '';
        }

        return { label: field.label, value };
    });

    const missingRequired = publicContactSchema
        .map((field, idx) => ({ field, value: answers[idx]?.value || '' }))
        .filter(({ field, value }) => field.required && !value);

    if (missingRequired.length) {
        setContactStatus(`${missingRequired[0].field.label} 항목을 입력해주세요.`, 'error');
        return;
    }

    if (publicContactSettings.consentRequired) {
        const consentInput = document.getElementById('user-contact-consent-input');
        if (!consentInput?.checked) {
            setContactStatus('개인정보 수집/이용에 동의해주세요.', 'error');
            return;
        }
    }

    try {
        submitBtn.disabled = true;
        setContactStatus('문의 내용을 전송하는 중입니다...', 'info');

        const honeypot = document.getElementById('user-contact-company');
        const turnstileToken = window.__turnstileToken || '';

        const res = await apiFetch(`/api/pages/${encodeURIComponent(currentPageId)}/contact`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                answers,
                company: honeypot?.value || '',
                consentChecked: document.getElementById('user-contact-consent-input')?.checked || false,
                turnstileToken: turnstileToken || undefined,
            }),
        }, [400, 404, 422]);

        if (!res.ok) {
            const msg = await res.text();
            throw new Error(msg || `저장 실패 (${res.status})`);
        }

        setContactStatus('문의가 접수되었습니다. 관리자가 확인할 때까지 기다려주세요.', 'success');
        form.reset();
        if (window.turnstile && typeof window.turnstile.reset === 'function') {
            window.turnstile.reset();
            window.__turnstileToken = '';
        }
    } catch (error) {
        console.error('컨택트 제출 실패', error);
        setContactStatus(error?.message || '문의 전송에 실패했습니다.', 'error');
    } finally {
        submitBtn.disabled = false;
    }
}

async function fetchContactSubmissions() {
    const status = document.getElementById('contact-submission-status');
    if (!derivedPageId || !status) {
        return;
    }

    const token = sessionStorage.getItem('page_admin_token');
    if (!token) {
        status.style.display = 'block';
        status.className = 'status-banner warning';
        status.innerText = '로그인 후 문의 내역을 확인할 수 있습니다.';
        return;
    }

    status.style.display = 'block';
    status.className = 'status-banner info';
    status.innerText = '문의 내역을 불러오는 중입니다...';

    try {
        const res = await apiFetch(`/api/page/${encodeURIComponent(derivedPageId)}/contact-submissions`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}` },
        }, [401, 403, 404]);

        if (!res.ok) {
            const msg = await res.text();
            throw new Error(msg || `불러오기 실패 (${res.status})`);
        }

        const payload = await res.json().catch(() => null);
        contactSubmissions = Array.isArray(payload?.submissions) ? payload.submissions : [];
        renderContactSubmissions();
    } catch (error) {
        status.style.display = 'block';
        status.className = 'status-banner error';
        status.innerText = error?.message || '문의 내역을 불러오지 못했습니다.';
    }
}

async function downloadContactCsv() {
    const status = document.getElementById('contact-submission-status');
    if (!derivedPageId || !status) return;

    const token = sessionStorage.getItem('page_admin_token');
    if (!token) {
        status.style.display = 'block';
        status.className = 'status-banner warning';
        status.innerText = '로그인 후 CSV를 다운로드할 수 있습니다.';
        return;
    }

    status.style.display = 'block';
    status.className = 'status-banner info';
    status.innerText = 'CSV를 생성하는 중입니다...';

    try {
        const res = await apiFetch(`/api/page/${encodeURIComponent(derivedPageId)}/contact-submissions.csv`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}` },
        }, [401, 403, 404]);

        if (!res.ok) {
            const msg = await res.text();
            throw new Error(msg || `다운로드 실패 (${res.status})`);
        }

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `contact-submissions-${derivedPageId}.csv`;
        anchor.style.display = 'none';
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);

        status.className = 'status-banner success';
        status.innerText = 'CSV를 다운로드했습니다.';
    } catch (error) {
        status.className = 'status-banner error';
        status.innerText = error?.message || 'CSV 다운로드에 실패했습니다.';
    }
}

async function clearContactSubmissions() {
    const status = document.getElementById('contact-submission-status');
    if (!derivedPageId || !status) return;

    const token = sessionStorage.getItem('page_admin_token');
    if (!token) {
        status.style.display = 'block';
        status.className = 'status-banner warning';
        status.innerText = '로그인 후 문의 삭제가 가능합니다.';
        return;
    }

    const input = prompt('삭제할 범위를 입력하세요. 전체 삭제는 ALL, 보관 기간(일)은 숫자 입력 (예: 180)', 'ALL');
    if (!input) return;
    const trimmed = input.trim().toUpperCase();
    const beforeDays = trimmed === 'ALL' ? null : Number(trimmed);

    status.style.display = 'block';
    status.className = 'status-banner info';
    status.innerText = '문의 내역을 삭제하는 중입니다...';

    try {
        const query = Number.isFinite(beforeDays) ? `?beforeDays=${encodeURIComponent(beforeDays)}` : '';
        const res = await apiFetch(`/api/page/${encodeURIComponent(derivedPageId)}/contact-submissions${query}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
        }, [401, 403, 404]);

        if (!res.ok) {
            const msg = await res.text();
            throw new Error(msg || `삭제 실패 (${res.status})`);
        }

        status.className = 'status-banner success';
        status.innerText = '문의 내역이 삭제되었습니다.';
        contactSubmissions = [];
        renderContactSubmissions();
    } catch (error) {
        status.className = 'status-banner error';
        status.innerText = error?.message || '문의 삭제에 실패했습니다.';
    }
}

function renderPrivateTemplates() {
    const list = document.getElementById('private-template-list');
    if (!list) return;

    list.innerHTML = '';
    if (!privateTemplates.length) {
        const empty = document.createElement('li');
        empty.className = 'empty';
        empty.innerText = '등록된 템플릿이 없습니다.';
        list.appendChild(empty);
        return;
    }

    privateTemplates.forEach((template) => {
        const item = document.createElement('li');
        item.className = 'link-item';

        const title = document.createElement('div');
        title.className = 'link-info';
        title.innerHTML = `<strong>${template.name}</strong><div class="muted">${template.payload?.note || '설정된 메모 없음'}</div>`;
        item.appendChild(title);

        const actions = document.createElement('div');
        actions.className = 'link-actions';

        const issueBtn = document.createElement('button');
        issueBtn.type = 'button';
        issueBtn.className = 'secondary';
        issueBtn.innerText = '링크 발급';
        issueBtn.onclick = () => issuePrivateLinkFromTemplate(template.id);

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'ghost';
        deleteBtn.innerText = '삭제';
        deleteBtn.onclick = () => deletePrivateTemplate(template.id);

        actions.appendChild(issueBtn);
        actions.appendChild(deleteBtn);
        item.appendChild(actions);
        list.appendChild(item);
    });
}

async function loadPrivateTemplates() {
    const token = sessionStorage.getItem('page_admin_token');
    if (!token || !derivedPageId) return;

    try {
        const res = await apiFetch(`/api/page/${encodeURIComponent(derivedPageId)}/private-templates`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}` },
        }, [401, 403, 404]);

        if (!res.ok) return;
        const payload = await res.json().catch(() => null);
        privateTemplates = Array.isArray(payload?.items) ? payload.items : [];
        renderPrivateTemplates();
    } catch (error) {
        console.warn('템플릿 목록을 불러오지 못했습니다.', error);
    }
}

async function createPrivateTemplate() {
    const token = sessionStorage.getItem('page_admin_token');
    if (!token || !derivedPageId) return;

    const nameInput = document.getElementById('template-name');
    const expiresInput = document.getElementById('template-expires');
    const maxUsesInput = document.getElementById('template-maxuses');
    const noteInput = document.getElementById('template-note');

    const name = nameInput?.value?.trim();
    if (!name) {
        alert('템플릿 이름을 입력하세요.');
        return;
    }

    const payload = {
        ...(expiresInput?.value ? { expiresAt: expiresInput.value.trim() } : {}),
        ...(maxUsesInput?.value ? { maxUses: Number(maxUsesInput.value) } : {}),
        ...(noteInput?.value ? { note: noteInput.value.trim() } : {}),
    };

    const res = await apiFetch(`/api/page/${encodeURIComponent(derivedPageId)}/private-templates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name, payload }),
    }, [400, 401, 403]);

    if (!res.ok) {
        const msg = await res.text();
        alert(`템플릿 생성 실패: ${msg || res.status}`);
        return;
    }

    const created = await res.json().catch(() => null);
    privateTemplates = [created, ...privateTemplates];
    renderPrivateTemplates();

    if (nameInput) nameInput.value = '';
    if (expiresInput) expiresInput.value = '';
    if (maxUsesInput) maxUsesInput.value = '';
    if (noteInput) noteInput.value = '';
}

async function deletePrivateTemplate(templateId) {
    const token = sessionStorage.getItem('page_admin_token');
    if (!token || !derivedPageId) return;
    if (!confirm('템플릿을 삭제할까요?')) return;

    await apiFetch(`/api/page/${encodeURIComponent(derivedPageId)}/private-templates/${encodeURIComponent(templateId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
    }, [401, 403, 404]);

    privateTemplates = privateTemplates.filter((item) => item.id !== templateId);
    renderPrivateTemplates();
}

async function issuePrivateLinkFromTemplate(templateId) {
    const token = sessionStorage.getItem('page_admin_token');
    if (!token || !derivedPageId) return;

    const res = await apiFetch(`/api/page/${encodeURIComponent(derivedPageId)}/private-templates/${encodeURIComponent(templateId)}/links`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
    }, [401, 403, 404]);

    if (!res.ok) {
        const msg = await res.text();
        alert(`링크 발급 실패: ${msg || res.status}`);
        return;
    }

    const payload = await res.json().catch(() => null);
    const tokenValue = payload?.token;
    if (tokenValue) {
        const linkUrl = `${window.location.origin}/${encodeURIComponent(derivedPageId)}/private/${encodeURIComponent(tokenValue)}`;
        alert(`프라이빗 링크가 발급되었습니다: ${linkUrl}`);
    }
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
            : createCustomIcon(link.iconUrl, link.title || '아이콘') || (() => {
                const fallback = document.createElement('span');
                fallback.className = 'link-icon platform-icon-fallback';
                fallback.innerText = '🔗';
                return fallback;
            })();

        if (iconEl) meta.appendChild(iconEl);

        const metaLabel = document.createElement('span');
        metaLabel.innerText = platformInfo?.preset?.label || link.title || '링크';
        meta.appendChild(metaLabel);

        if (link.isPrivate) {
            const lock = document.createElement('span');
            lock.innerText = '🔒';
            lock.title = '비공개 링크';
            meta.appendChild(lock);
        }

        header.appendChild(reorder);
        header.appendChild(meta);

        const fields = document.createElement('div');
        fields.className = 'link-row-fields';

        const nameInput = document.createElement('input');
        nameInput.placeholder = '링크 이름';
        nameInput.value = link.title || '';
        nameInput.oninput = (e) => updateAdminLink(index, 'title', e.target.value);
        fields.appendChild(nameInput);

        const privacyToggle = document.createElement('label');
        privacyToggle.className = 'link-privacy';
        const privacyInput = document.createElement('input');
        privacyInput.type = 'checkbox';
        privacyInput.checked = !!link.isPrivate;
        privacyInput.onchange = (e) => updateAdminLink(index, 'isPrivate', e.target.checked);
        const privacyLabel = document.createElement('span');
        privacyLabel.innerText = '비공개';
        privacyToggle.appendChild(privacyInput);
        privacyToggle.appendChild(privacyLabel);
        fields.appendChild(privacyToggle);

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

    renderPrivacySummary();
    renderUsage();
    renderOnboardingBanner();
}

function splitAdminLinks() {
    const publicLinks = adminLinks.filter((link) => !link.isPrivate);
    const privateLinks = adminLinks.filter((link) => !!link.isPrivate);
    return { publicLinks, privateLinks };
}

function renderPrivacySummary() {
    const summaryEl = document.getElementById('private-links-summary');
    if (!summaryEl) return;

    const { privateLinks } = splitAdminLinks();
    if (!adminLinks.length) {
        summaryEl.innerText = '아직 추가된 링크가 없습니다. 링크를 추가하면 비공개 여부를 여기에서 확인할 수 있습니다.';
        return;
    }

    const privacyList = privateLinks.map((link) => link.title || link.url || '비공개 링크');
    summaryEl.innerHTML = `총 <strong>${adminLinks.length}</strong>개 링크 중 <strong>${privateLinks.length}</strong>개가 비공개입니다.<br>` +
        (privacyList.length ? `🔒 ${privacyList.join(', ')}` : '🔓 모든 링크가 공개 상태입니다.');
}

function renderUsage() {
    const planLabel = document.getElementById('plan-label');
    const usageCount = document.getElementById('usage-count');
    const usageBar = document.getElementById('usage-bar');
    const usageHelp = document.getElementById('usage-help');
    if (!planLabel || !usageCount || !usageBar || !usageHelp) return;

    const { publicLinks, privateLinks } = splitAdminLinks();
    const limits = pagePlanStatus?.limits;
    const usage = pagePlanStatus?.usage;
    let limit = PLAN_LIMITS[pagePlan] || PLAN_LIMITS.free;
    let used = publicLinks.length + privateLinks.length + adminContactSchema.length;

    if (limits && usage) {
        limit = Number(limits.max_private_links || 0) + Number(limits.max_contact_fields || 0);
        used = Number(usage.privateLinks || 0) + Number(usage.contactFields || 0);
    }

    const percent = Math.min(100, Math.round((used / (limit || 1)) * 100));
    planLabel.innerText = `플랜: ${pagePlan || 'free'}`;
    usageCount.innerText = `${used} / ${limit || '-'}`;
    usageBar.style.width = `${isFinite(percent) ? percent : 0}%`;

    if (limits && usage) {
        usageHelp.innerText = `프라이빗 ${usage.privateLinks}/${limits.max_private_links} | 컨택트 ${usage.contactFields}/${limits.max_contact_fields}`;
    } else {
        usageHelp.innerText = `공개 ${publicLinks.length}개, 비공개 ${privateLinks.length}개 | 컨택트 ${adminContactSchema.length}개`;
    }
}

function renderSlugEditor() {
    const chipList = document.getElementById('slug-chip-list');
    const primaryInput = document.getElementById('primary-slug-input');
    if (!adminSlugs.length && derivedPageId) {
        adminSlugs = [slugify(derivedPageId)];
    }
    if (primaryInput) {
        primaryInput.value = adminSlugs[0] || '';
    }

    if (!chipList) return;
    chipList.innerHTML = '';

    adminSlugs.forEach((slug, idx) => {
        const pill = document.createElement('span');
        pill.className = 'pill';
        pill.innerText = slug;

        if (idx > 0) {
            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.innerText = '×';
            removeBtn.onclick = () => removeSlugAlias(slug);
            pill.appendChild(removeBtn);
        } else {
            const primaryBadge = document.createElement('span');
            primaryBadge.className = 'badge muted';
            primaryBadge.innerText = '대표';
            pill.appendChild(primaryBadge);
        }

        chipList.appendChild(pill);
    });
}

function setPrimarySlug(value) {
    const next = slugify(value || derivedPageId || '');
    if (!next) return;
    adminSlugs = [next, ...adminSlugs.filter((slug) => slug !== next)];
    renderSlugEditor();
    updatePageContext(derivedPageId || next);
}

function addSlugAlias() {
    const input = document.getElementById('slug-alias-input');
    const raw = input?.value?.trim();
    if (!raw) return;

    const next = slugify(raw);
    if (!next) {
        alert('사용할 수 없는 슬러그입니다.');
        return;
    }

    if (!adminSlugs.includes(next)) {
        adminSlugs.push(next);
        renderSlugEditor();
        updatePageContext(derivedPageId || next);
    }

    if (input) input.value = '';
}

function removeSlugAlias(slug) {
    adminSlugs = adminSlugs.filter((item, idx) => item !== slug || idx === 0);
    renderSlugEditor();
    updatePageContext(derivedPageId || adminSlugs[0] || slug);
}

function renderContactSchema() {
    renderContactSchemaEditor();
}

function renderContactSchema() {
    renderContactSchemaEditor();
}

function hydrateContactSettings() {
    const webhookInput = document.getElementById('contactWebhook');
    const webhookUrlsInput = document.getElementById('contactWebhookUrls');
    const formTitleInput = document.getElementById('contactFormTitle');
    const formDescriptionInput = document.getElementById('contactFormDescription');
    const consentTextInput = document.getElementById('contactConsentText');
    const consentRequiredInput = document.getElementById('contactConsentRequired');
    const emailRecipientsInput = document.getElementById('contactEmailRecipients');
    const emailSubjectInput = document.getElementById('contactEmailSubject');
    const enabledInput = document.getElementById('contactEnabled');
    if (!webhookInput || !enabledInput) return;

    const parseLines = (value) =>
        value
            .split('\n')
            .map((item) => item.trim())
            .filter(Boolean);

    webhookInput.value = contactSettings.webhookUrl || '';
    webhookInput.oninput = (e) => {
        const value = (e.target.value || '').trim();
        const enabled = contactSettings.enabled === true;
        contactSettings = value ? { ...contactSettings, webhookUrl: value } : { enabled };
    };

    if (webhookUrlsInput) {
        webhookUrlsInput.value = Array.isArray(contactSettings.webhookUrls)
            ? contactSettings.webhookUrls.join('\n')
            : '';
        webhookUrlsInput.oninput = (e) => {
            const list = parseLines(e.target.value || '');
            contactSettings = list.length
                ? { ...contactSettings, webhookUrls: list }
                : { ...contactSettings, webhookUrls: [] };
        };
    }

    if (formTitleInput) {
        formTitleInput.value = contactSettings.formTitle || '';
        formTitleInput.oninput = (e) => {
            contactSettings = { ...contactSettings, formTitle: e.target.value || '' };
        };
    }

    if (formDescriptionInput) {
        formDescriptionInput.value = contactSettings.formDescription || '';
        formDescriptionInput.oninput = (e) => {
            contactSettings = { ...contactSettings, formDescription: e.target.value || '' };
        };
    }

    if (consentTextInput) {
        consentTextInput.value = contactSettings.consentText || '';
        consentTextInput.oninput = (e) => {
            contactSettings = { ...contactSettings, consentText: e.target.value || '' };
        };
    }

    if (consentRequiredInput) {
        consentRequiredInput.checked = contactSettings.consentRequired === true;
        consentRequiredInput.onchange = (e) => {
            contactSettings = { ...contactSettings, consentRequired: !!e.target.checked };
        };
    }

    if (emailRecipientsInput) {
        emailRecipientsInput.value = Array.isArray(contactSettings.emailRecipients)
            ? contactSettings.emailRecipients.join('\n')
            : '';
        emailRecipientsInput.oninput = (e) => {
            const raw = (e.target.value || '').split(/[\n,]/);
            const list = raw.map((item) => item.trim()).filter(Boolean);
            contactSettings = list.length
                ? { ...contactSettings, emailRecipients: list }
                : { ...contactSettings, emailRecipients: [] };
        };
    }

    if (emailSubjectInput) {
        emailSubjectInput.value = contactSettings.emailSubject || '';
        emailSubjectInput.oninput = (e) => {
            contactSettings = { ...contactSettings, emailSubject: e.target.value || '' };
        };
    }

    enabledInput.checked = contactSettings.enabled === true;
    enabledInput.onchange = (e) => {
        const enabled = !!e.target.checked;
        contactSettings = { ...contactSettings, enabled };
    };
}

function renderContactSchemaEditor() {
    const list = document.getElementById('contact-schema-list');
    if (!list) return;

    list.innerHTML = '';
    if (!adminContactSchema || !adminContactSchema.length) {
        const empty = document.createElement('p');
        empty.className = 'help-text';
        empty.innerText = '추가된 컨택트 필드가 없습니다. 아래 폼에서 필드를 추가해주세요.';
        list.appendChild(empty);
    } else {
        adminContactSchema.forEach((field, idx) => {
            const row = document.createElement('div');
            row.className = 'contact-row';

            const labelInput = document.createElement('input');
            labelInput.placeholder = '라벨';
            labelInput.value = field.label || '';
            labelInput.oninput = (e) => {
                adminContactSchema[idx].label = e.target.value;
            };

            const typeSelect = document.createElement('select');
            ['text', 'email', 'tel', 'url', 'textarea'].forEach((type) => {
                const opt = document.createElement('option');
                opt.value = type;
                opt.innerText = type.charAt(0).toUpperCase() + type.slice(1);
                if (field.type === type) opt.selected = true;
                typeSelect.appendChild(opt);
            });
            typeSelect.onchange = (e) => {
                adminContactSchema[idx].type = e.target.value;
            };
            
            const requiredToggle = document.createElement('label');
            requiredToggle.className = 'inline-toggle';
            const requiredInput = document.createElement('input');
            requiredInput.type = 'checkbox';
            requiredInput.checked = !!field.required;
            requiredInput.onchange = (e) => {
                adminContactSchema[idx].required = e.target.checked;
            };
            requiredToggle.appendChild(requiredInput);
            requiredToggle.append(' 필수');

            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'pill-button ghost';
            removeBtn.innerText = '삭제';
            removeBtn.onclick = () => {
                adminContactSchema.splice(idx, 1);
                renderContactSchemaEditor();
            };

            row.appendChild(labelInput);
            row.appendChild(typeSelect);
            row.appendChild(requiredToggle);
            row.appendChild(removeBtn);
            list.appendChild(row);
        });
    }
}

function renderContactSubmissions() {
    const list = document.getElementById('contact-submission-list');
    const status = document.getElementById('contact-submission-status');
    if (!list || !status) return;

    list.innerHTML = '';

    if (!contactSubmissions.length) {
        status.style.display = 'block';
        status.className = 'status-banner info';
        status.innerText = '아직 제출된 문의가 없습니다.';
        return;
    }

    status.style.display = 'none';

    contactSubmissions.forEach((submission) => {
        const item = document.createElement('li');
        item.className = 'contact-submission';

        const header = document.createElement('header');
        const time = document.createElement('span');
        time.innerText = new Date(submission.submittedAt).toLocaleString();
        const meta = document.createElement('span');
        meta.innerText = submission.ip ? `IP: ${submission.ip}` : '';
        header.appendChild(time);
        header.appendChild(meta);

        item.appendChild(header);

        (submission.answers || []).forEach((answer) => {
            const row = document.createElement('div');
            row.className = 'contact-answer';

        const label = document.createElement('div');
        label.className = 'label';
        label.innerText = answer.label;

        const value = document.createElement('div');
        value.className = 'value';
        value.innerText = answer.value;

        row.appendChild(label);
        row.appendChild(value);
        item.appendChild(row);
    });

    if (Array.isArray(submission.deliveryErrors) && submission.deliveryErrors.length) {
        const errorRow = document.createElement('div');
        errorRow.className = 'contact-answer delivery-errors';
        const errorLabel = document.createElement('div');
        errorLabel.className = 'label';
        errorLabel.innerText = '전송 실패';
        const errorValue = document.createElement('div');
        errorValue.className = 'value';
        errorValue.innerText = submission.deliveryErrors.join(', ');
        errorRow.appendChild(errorLabel);
        errorRow.appendChild(errorValue);
        item.appendChild(errorRow);
    }

        list.appendChild(item);
    });
}

function renderPresetButtons(targetId, onClick) {
    const container = document.getElementById(targetId);
    if (!container) return;
    container.innerHTML = '';

    CONTACT_PRESETS.forEach((preset) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'preset-chip';
        btn.innerText = preset.label;
        btn.onclick = () => onClick(preset);
        container.appendChild(btn);
    });
}

function renderContactPresets() {
    renderPresetButtons('contact-preset-buttons', (preset) => {
        if (!confirm(`${preset.label} 프리셋으로 덮어쓸까요? 기존 필드 구성은 사라집니다.`)) return;
        adminContactSchema = JSON.parse(JSON.stringify(preset.fields));
        renderContactSchemaEditor();
    });
}

function applyThemeToScopes() {
    const validTheme = THEME_PRESETS.some((preset) => preset.id === pageTheme) ? pageTheme : 'classic';
    pageTheme = validTheme;

    const scopes = document.querySelectorAll('.theme-scope');
    scopes.forEach((scope) => {
        THEME_PRESETS.forEach((preset) => scope.classList.remove(`theme-${preset.id}`));
        scope.classList.add(`theme-${validTheme}`);
    });
}

function renderThemeOptions() {
    const host = document.getElementById('theme-options');
    if (!host) return;

    host.innerHTML = '';

    THEME_PRESETS.forEach((preset) => {
        const tile = document.createElement('button');
        tile.type = 'button';
        tile.className = `theme-tile ${preset.id === pageTheme ? 'active' : ''}`;
        tile.setAttribute('aria-pressed', preset.id === pageTheme ? 'true' : 'false');

        const swatch = document.createElement('div');
        swatch.className = 'theme-swatch';
        (preset.swatch || []).slice(0, 4).forEach((color) => {
            const cell = document.createElement('span');
            cell.style.background = color;
            swatch.appendChild(cell);
        });

        const meta = document.createElement('div');
        meta.className = 'theme-meta';
        const title = document.createElement('div');
        title.className = 'title';
        title.innerText = preset.label;
        const desc = document.createElement('div');
        desc.className = 'desc';
        desc.innerText = preset.desc;
        meta.appendChild(title);
        meta.appendChild(desc);

        tile.appendChild(swatch);
        tile.appendChild(meta);
        tile.onclick = () => {
            pageTheme = preset.id;
            applyThemeToScopes();
            renderThemeOptions();
        };

        host.appendChild(tile);
    });
}

function renderOnboardingBanner() {
    const banner = document.getElementById('onboarding-banner');
    if (!banner) return;
    const hasProfile = !!(document.getElementById('name')?.value?.trim() && document.getElementById('desc')?.value?.trim());
    const hasLinks = adminLinks.length > 0;
    if (hasProfile && hasLinks) {
        banner.style.display = 'none';
    } else {
        banner.style.display = 'block';
    }
}

function renderTurnstileWidget() {
    const host = document.getElementById('turnstile-widget');
    if (!host || !APP_CONFIG.turnstileSiteKey) return;
    
    if (typeof turnstile !== 'undefined') {
        try {
            window.__turnstileId = turnstile.render(host, {
                sitekey: APP_CONFIG.turnstileSiteKey,
                callback: (token) => {
                    window.__turnstileToken = token;
                },
            });
        } catch(e) {
            console.error('Turnstile 렌더링 실패', e);
        }
    }
}

function setPageLoginStatus(message, tone = 'info') {
    const statusEl = document.getElementById('page-login-status');
    if (!statusEl) return false;
    
    statusEl.textContent = message;
    statusEl.className = `status-banner ${tone}`;
    statusEl.style.display = message ? 'block' : 'none';

    return true;
}