function slugify(value) {
    const normalized = value.normalize('NFKD').toLowerCase();

    const separated = normalized
        .replace(/[\s\p{P}\p{S}_]+/gu, '-')
        .replace(/-+/g, '-');

    const cleaned = separated.replace(/[^a-z0-9-]/g, '');
    const collapsed = cleaned.replace(/-+/g, '-').replace(/^-+|-+$/g, '');

    if (collapsed) {
        return collapsed;
    }

    const encodedFallback = encodeURIComponent(normalized)
        .replace(/%/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '');

    return encodedFallback;
}

const platformHelpers = window.PlatformHelpers || {};
const PLATFORM_PRESETS = platformHelpers.PLATFORM_PRESETS || [];
const getPlatformPreset = platformHelpers.getPlatformPreset || ((platformId) => PLATFORM_PRESETS.find((preset) => preset.id === platformId));
const buildPlatformUrl = platformHelpers.buildPlatformUrl || function (preset, handle) {
    const cleanHandle = (handle || '').trim().replace(/^\/+/, '');
    return cleanHandle ? `${preset.baseUrl}${cleanHandle}` : '';
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

function createPlatformIcon(preset, className = 'platform-icon') {
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
let editingPageId = null;
let managedLinks = [];
let aliasSlugs = [];
let selectedPlatformId = PLATFORM_PRESETS[0]?.id || '';
let pageListState = { page: 1, pageSize: 30, total: 0, search: '' };

function createCustomLinkIcon(url, alt = '') {
    if (!url) return null;

    const iconEl = document.createElement('img');
    iconEl.src = url;
    iconEl.alt = alt;
    iconEl.className = 'custom-icon-preview';
    iconEl.onerror = () => iconEl.remove();
    return iconEl;
}

function setFormTitle(titleText) {
    const titleEl = document.getElementById('form-title');
    if (titleEl) titleEl.innerText = titleText;
}

function setPlatformSelection(platformId) {
    selectedPlatformId = platformId;
    renderPlatformSelector();
    updatePlatformPrefix();
}

function updatePlatformPrefix() {
    const preset = getPlatformPreset(selectedPlatformId) || PLATFORM_PRESETS[0];
    const prefixEl = document.getElementById('platform-prefix');
    const handleInput = document.getElementById('saPlatformHandle');

    if (prefixEl) {
        prefixEl.innerText = preset?.baseUrl || '';
    }

    if (handleInput) {
        handleInput.placeholder = preset?.placeholder || '고유 아이디';
    }
}

function resetForm() {
    editingPageId = null;
    managedLinks = [];
    document.getElementById('pageName').value = '';
    document.getElementById('pageSlug').value = '';
    document.getElementById('pageSlug').removeAttribute('disabled');
    document.getElementById('pageDescription').value = '';
    document.getElementById('pagePhoto').value = '';
    document.getElementById('adminPassword').value = '';
    document.getElementById('plan').value = 'free';
    selectedPlatformId = PLATFORM_PRESETS[0]?.id || '';
    document.getElementById('saPlatformHandle').value = '';
    document.getElementById('saPlatformName').value = '';
    const customIconInput = document.getElementById('saLinkIcon');
    if (customIconInput) customIconInput.value = '';
    updatePlatformPrefix();
    renderPlatformSelector();
    renderSuperAdminLinks();
    aliasSlugs = [];
    renderAliasSlugs();
    setFormTitle('페이지 생성');
    const submitBtn = document.getElementById('submit-btn');
    if (submitBtn) submitBtn.innerText = '페이지 생성';
    const cancelBtn = document.getElementById('cancel-edit-btn');
    if (cancelBtn) cancelBtn.style.display = 'none';
}

// 페이지 생성/수정 함수
async function submitPage() {
    const name = document.getElementById('pageName').value.trim();
    const rawSlug = document.getElementById('pageSlug').value.trim();
    const normalizedSlug = slugify(rawSlug);
    const description = document.getElementById('pageDescription').value.trim();
    const photoUrl = document.getElementById('pagePhoto').value.trim();
    const adminPassword = document.getElementById('adminPassword').value;
    const plan = document.getElementById('plan').value || 'free';

    if (!editingPageId && ((!rawSlug && !normalizedSlug) || !adminPassword)) {
        alert('슬러그와 관리자 비밀번호는 필수 입력입니다.');
        return;
    }

  if (managedLinks.some(link => !link.name || !link.url)) {
    alert('모든 링크는 이름과 URL을 모두 입력해야 합니다.');
    return;
  }

  const slugs = [
    rawSlug,
    normalizedSlug,
    ...aliasSlugs.flatMap((value) => {
      const trimmed = value?.trim?.() || "";
      if (!trimmed) return [];
      const slugified = slugify(trimmed);
      return [trimmed, slugified].filter(Boolean);
    }),
  ].filter(Boolean);

    const data = {
        pageId: rawSlug || normalizedSlug,
        profile: {
            name: name,
            description: description,
            photoUrl: photoUrl
        },
    links: managedLinks,
    adminPassword: adminPassword || undefined,
    plan: plan,
    slugs
  };

    const targetPageId = editingPageId || rawSlug || normalizedSlug;
    if (!targetPageId) {
        alert('페이지 식별자를 입력하세요.');
        return;
    }

    const token = sessionStorage.getItem('super_admin_token');
    if (!token) {
        alert('슈퍼 관리자 로그인이 필요합니다. 로그인 후 다시 시도하세요.');
        return;
    }

    const method = editingPageId ? 'PUT' : 'POST';
    const endpoint = editingPageId
        ? `/api/admin/pages/${encodeURIComponent(targetPageId)}`
        : '/api/admin/pages';

    const res = await apiFetch(endpoint, {
        method,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(data)
    });

    if (res.ok) {
        alert(editingPageId ? '페이지가 수정되었습니다.' : '페이지가 생성되었습니다.');
        resetForm();
        loadPageList();  // 페이지 목록 갱신
    } else {
        const errText = await res.text();
        alert(`페이지 저장 실패: ${errText || res.status}`);
    }
}

// 페이지 목록 불러오기 (검색/페이지네이션 지원)
async function loadPageList(page = pageListState.page) {
    const token = sessionStorage.getItem('super_admin_token');
    if (!token) {
        console.warn('슈퍼 관리자 토큰이 없습니다. 로그인 후 목록을 확인하세요.');
        return;
    }

    const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageListState.pageSize),
    });

    if (pageListState.search.trim()) {
        params.set('search', pageListState.search.trim());
    }

    const res = await apiFetch(`/api/admin/pages?${params.toString()}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!res.ok) {
        const errText = await res.text();
        alert(`페이지 목록 불러오기 실패: ${errText || res.status}`);
        return;
    }

    const payload = await res.json();
    const pages = Array.isArray(payload.items) ? payload.items : [];
    pageListState = {
        ...pageListState,
        page: payload.page || page,
        pageSize: payload.pageSize || pageListState.pageSize,
        total: payload.total || 0,
    };

    renderPageList(pages);
    renderPagination();
}

function renderPageList(pages) {
  const pageList = document.getElementById('pages');
  if (!pageList) return;

  if (!pages.length) {
    pageList.innerHTML = '<li>검색 결과가 없습니다. 새로운 페이지를 생성하거나 검색어를 바꿔보세요.</li>';
    return;
  }

  pageList.innerHTML = pages.map(page => {
    const slugList = Array.isArray(page.slugs) && page.slugs.length ? page.slugs : [page.pageId];
    const primarySlug = slugList[0];
    const slugLabel = slugList.join(', ');
    return `
        <li>
            <div class="page-meta">
                <strong>${page.profile?.name || page.pageId}</strong> (${slugLabel})
                <span class="plan-badge">플랜: ${page.plan || 'free'}</span>
            </div>
            <div class="page-actions">
                <a class="preview-link" href="/${primarySlug}" target="_blank" rel="noopener">페이지 보기</a>
                <button onclick="editPage('${page.pageId}')">편집</button>
                <button onclick="deletePage('${page.pageId}')">삭제</button>
            </div>
        </li>
    `;
  }).join('');
}

function renderPagination() {
  const pageInfo = document.getElementById('page-info');
  const prevBtn = document.getElementById('prev-page');
  const nextBtn = document.getElementById('next-page');

  const totalPages = Math.max(1, Math.ceil((pageListState.total || 0) / pageListState.pageSize));
  const currentPage = Math.min(pageListState.page, totalPages);

  if (pageInfo) {
    pageInfo.innerText = `${currentPage} / ${totalPages} 페이지 (총 ${pageListState.total}개)`;
  }

  if (prevBtn) {
    prevBtn.disabled = currentPage <= 1;
    prevBtn.onclick = () => loadPageList(currentPage - 1);
  }

  if (nextBtn) {
    nextBtn.disabled = currentPage >= totalPages;
    nextBtn.onclick = () => loadPageList(currentPage + 1);
  }
}

// 페이지 삭제
async function deletePage(pageId) {
    const token = sessionStorage.getItem('super_admin_token');
    if (!token) {
        alert('슈퍼 관리자 로그인이 필요합니다.');
        return;
    }

    const res = await apiFetch(`/api/admin/pages/${pageId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
    });

    if (res.ok) {
        alert('페이지가 삭제되었습니다.');
        loadPageList();  // 페이지 목록 갱신
    } else {
        const errText = await res.text();
        alert(`페이지 삭제 실패: ${errText || res.status}`);
    }
}

// 페이지 수정
async function editPage(pageId) {
    const token = sessionStorage.getItem('super_admin_token');
    if (!token) {
        alert('슈퍼 관리자 로그인이 필요합니다.');
        return;
    }

  const res = await apiFetch(`/api/admin/pages/${encodeURIComponent(pageId)}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });

  if (!res.ok) {
    const errText = await res.text();
    alert(`페이지 정보를 불러오지 못했습니다: ${errText || res.status}`);
    return;
  }

  const page = await res.json();

    if (!page) {
        alert('해당 페이지 정보를 찾지 못했습니다.');
        return;
    }

    editingPageId = page.pageId;
    document.getElementById('pageName').value = page.profile?.name || '';
    document.getElementById('pageSlug').value = page.pageId;
  document.getElementById('pageSlug').setAttribute('disabled', 'true');
  document.getElementById('pageDescription').value = page.profile?.description || '';
  document.getElementById('pagePhoto').value = page.profile?.photoUrl || '';
  document.getElementById('adminPassword').value = '';
  document.getElementById('plan').value = page.plan || 'free';
  selectedPlatformId = PLATFORM_PRESETS[0]?.id || '';
  document.getElementById('saPlatformHandle').value = '';
  document.getElementById('saPlatformName').value = '';
  renderPlatformSelector();
  updatePlatformPrefix();
  managedLinks = Array.isArray(page.links) ? [...page.links] : [];
  renderSuperAdminLinks();

  const slugList = Array.isArray(page.slugs) ? page.slugs : [page.pageId];
  aliasSlugs = slugList
    .filter((slug) => slug !== page.pageId)
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean);
  renderAliasSlugs();
  setFormTitle(`페이지 수정: ${page.pageId}`);

    const submitBtn = document.getElementById('submit-btn');
    if (submitBtn) submitBtn.innerText = '수정 저장';
  const cancelBtn = document.getElementById('cancel-edit-btn');
  if (cancelBtn) cancelBtn.style.display = 'inline-block';
}

document.addEventListener('DOMContentLoaded', () => {
    const token = sessionStorage.getItem('super_admin_token');
    if (!token) {
        window.location.href = '/login.html';
        return;
    }
    renderPlatformSelector();
    updatePlatformPrefix();
    setupSlugInputs();
    resetForm();
    loadPageList();

    const searchInput = document.getElementById('page-search');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            pageListState = { ...pageListState, search: e.target.value || '', page: 1 };
            loadPageList(1);
        });
    }
});

function addSuperAdminLink() {
    const nameInput = document.getElementById('saLinkName');
    const urlInput = document.getElementById('saLinkUrl');
    const iconInput = document.getElementById('saLinkIcon');

    const name = nameInput?.value?.trim();
    const url = urlInput?.value?.trim();
    const iconUrl = iconInput?.value?.trim();

    if (!name || !url) {
        alert('링크 이름과 URL을 모두 입력하세요.');
        return;
    }

    managedLinks.push({ name, url, iconUrl });
    renderSuperAdminLinks();

    if (nameInput) nameInput.value = '';
    if (urlInput) urlInput.value = '';
    if (iconInput) iconInput.value = '';
}

function addPlatformLink() {
    const handleInput = document.getElementById('saPlatformHandle');
    const nameInput = document.getElementById('saPlatformName');
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

    managedLinks.push({ name, url, platformId: preset.id, handle });
    renderSuperAdminLinks();

    if (handleInput) handleInput.value = '';
    if (nameInput) nameInput.value = '';
}

function updateSuperAdminLink(index, field, value) {
    const target = managedLinks[index];
    if (!target) return;

    const platformInfo = inferPlatformFromLink(target);

    if (platformInfo) {
        const { preset } = platformInfo;
        if (field === 'handle') {
            const handle = value;
            managedLinks[index] = {
                ...target,
                handle,
                platformId: preset.id,
                url: buildPlatformUrl(preset, handle),
            };
            return;
        }
    }

    managedLinks[index] = { ...target, [field]: value };
}

function removeSuperAdminLink(index) {
    managedLinks.splice(index, 1);
    renderSuperAdminLinks();
}

function moveSuperAdminLink(index, direction) {
  const target = index + direction;
  if (target < 0 || target >= managedLinks.length) return;

  const [item] = managedLinks.splice(index, 1);
  managedLinks.splice(target, 0, item);
  renderSuperAdminLinks();
}

function renderSuperAdminLinks() {
  const list = document.getElementById('sa-link-list');
  if (!list) return;

  list.innerHTML = '';

    managedLinks.forEach((link, index) => {
        const platformInfo = inferPlatformFromLink(link);
        const li = document.createElement('li');
        li.className = 'link-row';

        const reorder = document.createElement('div');
        reorder.className = 'reorder-buttons';
        const upBtn = document.createElement('button');
        upBtn.type = 'button';
        upBtn.innerText = '▲';
        upBtn.onclick = () => moveSuperAdminLink(index, -1);
        const downBtn = document.createElement('button');
        downBtn.type = 'button';
        downBtn.innerText = '▼';
        downBtn.onclick = () => moveSuperAdminLink(index, 1);
        reorder.appendChild(upBtn);
        reorder.appendChild(downBtn);

        const nameInput = document.createElement('input');
        nameInput.placeholder = '링크 이름';
        nameInput.value = link.name || '';
        nameInput.oninput = (e) => updateSuperAdminLink(index, 'name', e.target.value);

        if (platformInfo) {
            const handleInput = document.createElement('input');
            handleInput.placeholder = platformInfo.preset.placeholder || '고유 아이디';
            const currentHandle = link.handle || platformInfo.handle || '';
            handleInput.value = currentHandle;
            handleInput.oninput = (e) => updateSuperAdminLink(index, 'handle', e.target.value);

            const prefixLabel = document.createElement('div');
            prefixLabel.className = 'platform-label';
            const iconEl = createPlatformIcon(platformInfo.preset, 'platform-icon-small');
            if (iconEl) prefixLabel.appendChild(iconEl);
            const labelText = document.createElement('span');
            labelText.innerText = platformInfo.preset.label;
            prefixLabel.appendChild(labelText);

            const removeBtn = document.createElement('button');
            removeBtn.innerText = '삭제';
            removeBtn.onclick = () => removeSuperAdminLink(index);

            li.appendChild(reorder);
            li.appendChild(prefixLabel);
            li.appendChild(nameInput);
            li.appendChild(handleInput);
            li.appendChild(removeBtn);

            managedLinks[index] = {
                ...link,
                platformId: platformInfo.preset.id,
                handle: currentHandle,
                url: buildPlatformUrl(platformInfo.preset, currentHandle),
            };

            list.appendChild(li);
            return;
        }

        const urlInput = document.createElement('input');
        urlInput.placeholder = '링크 URL';
        urlInput.value = link.url || '';
        urlInput.oninput = (e) => updateSuperAdminLink(index, 'url', e.target.value);

        const iconInput = document.createElement('input');
        iconInput.placeholder = '아이콘 URL (선택)';
        iconInput.value = link.iconUrl || '';
        iconInput.oninput = (e) => updateSuperAdminLink(index, 'iconUrl', e.target.value);

        const iconPreview = createCustomLinkIcon(link.iconUrl, link.name || '아이콘');

        const removeBtn = document.createElement('button');
        removeBtn.innerText = '삭제';
        removeBtn.onclick = () => removeSuperAdminLink(index);

        li.appendChild(reorder);
        li.appendChild(nameInput);
        li.appendChild(urlInput);
        li.appendChild(iconInput);
        if (iconPreview) li.appendChild(iconPreview);
        li.appendChild(removeBtn);

    list.appendChild(li);
  });
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
        const iconEl = createPlatformIcon(preset);
        const labelEl = document.createElement('span');
        labelEl.className = 'platform-button-label';
        labelEl.innerText = preset.label;
        if (iconEl) button.appendChild(iconEl);
        button.appendChild(labelEl);
        button.onclick = () => setPlatformSelection(preset.id);

        selector.appendChild(button);
    });
}

function addAliasSlug() {
  const input = document.getElementById('saSlugInput');
  const value = input?.value?.trim();

  if (!value) {
    alert('추가할 슬러그를 입력하세요.');
    return;
  }

  const mainSlug = document.getElementById('pageSlug')?.value?.trim() || '';
  const normalizedMainSlug = slugify(mainSlug);
  const slugValue = value;

  if (normalizedMainSlug && slugify(slugValue) === normalizedMainSlug) {
    alert('기본 슬러그와 동일한 값은 별칭으로 추가할 수 없습니다.');
    return;
  }

  if (aliasSlugs.includes(slugValue)) {
    alert('이미 추가된 슬러그입니다.');
    return;
  }

  aliasSlugs.push(slugValue);
  renderAliasSlugs();

  if (input) input.value = '';
}

function removeAliasSlug(index) {
  aliasSlugs.splice(index, 1);
  renderAliasSlugs();
}

function renderAliasSlugs() {
  const list = document.getElementById('sa-slug-list');
  if (!list) return;

  list.innerHTML = '';

  aliasSlugs.forEach((slug, index) => {
    const li = document.createElement('li');
    li.className = 'link-row';

    const slugInput = document.createElement('input');
    slugInput.placeholder = '추가 슬러그';
    slugInput.value = slug;
    slugInput.oninput = (e) => {
      aliasSlugs[index] = e.target.value;
    };

    const removeBtn = document.createElement('button');
    removeBtn.innerText = '삭제';
    removeBtn.onclick = () => removeAliasSlug(index);

    li.appendChild(slugInput);
    li.appendChild(removeBtn);
    list.appendChild(li);
  });
}

function setupSlugInputs() {
  const mainSlugInput = document.getElementById('pageSlug');
  if (!mainSlugInput) return;
}
