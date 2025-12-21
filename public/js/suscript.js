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

    const origin = window.location.origin;
    if (!bases.includes(origin)) {
        bases.push(origin);
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
let dragState = null;
let bulkUploadPages = [];
let bulkPreviewMeta = { filename: '', totalRows: 0, skipped: 0 };
let pageTheme = 'classic';

const THEME_PRESETS = [
    {
        id: 'classic',
        label: '클래식',
        desc: '밝은 기본 스타일',
        swatch: ['#f7f7fb', '#ffffff', '#16a34a', '#0f172a'],
    },
    {
        id: 'midnight',
        label: '미드나잇',
        desc: '어두운 배경 + 하늘색 포인트',
        swatch: ['#0b1220', '#0f172a', '#22d3ee', '#e5e7eb'],
    },
    {
        id: 'sunset',
        label: '선셋',
        desc: '따뜻한 주황/살구 톤',
        swatch: ['#fff7ed', '#fef3c7', '#f97316', '#7c2d12'],
    },
    {
        id: 'mint',
        label: '민트',
        desc: '시원한 민트/틸 포인트',
        swatch: ['#ecfeff', '#f0fdfa', '#14b8a6', '#042f2e'],
    },
];

function applyThemeToScopes() {
    const validTheme = THEME_PRESETS.some((preset) => preset.id === pageTheme)
        ? pageTheme
        : 'classic';
    pageTheme = validTheme;

    const scopes = document.querySelectorAll('.theme-scope');
    scopes.forEach((scope) => {
        THEME_PRESETS.forEach((preset) => scope.classList.remove(`theme-${preset.id}`));
        scope.classList.add(`theme-${validTheme}`);
    });
}

function renderThemeOptions() {
    const host = document.getElementById('sa-theme-options');
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

function updateThemePreview() {
    const nameInput = document.getElementById('pageName');
    const descInput = document.getElementById('pageDescription');
    const photoInput = document.getElementById('pagePhoto');

    const nameEl = document.getElementById('sa-theme-preview-name');
    const descEl = document.getElementById('sa-theme-preview-desc');
    const photoEl = document.getElementById('sa-theme-preview-photo');
    const linksEl = document.getElementById('sa-theme-preview-links');

    const name = nameInput?.value?.trim() || '페이지 이름';
    const desc = descInput?.value?.trim() || '페이지 설명을 입력하면 여기에 표시됩니다.';
    const photoUrl = photoInput?.value?.trim() || '';

    if (nameEl) nameEl.innerText = name;
    if (descEl) descEl.innerText = desc;
    if (photoEl) {
        if (photoUrl) {
            photoEl.src = photoUrl;
            photoEl.style.display = '';
        } else {
            photoEl.removeAttribute('src');
            photoEl.style.display = 'none';
        }
    }

    if (!linksEl) return;

    linksEl.innerHTML = '';
    linksEl.classList.add('link-stack');

    if (!managedLinks.length) {
        const empty = document.createElement('li');
        empty.className = 'help-text';
        empty.innerText = '링크가 아직 없습니다.';
        linksEl.appendChild(empty);
        return;
    }

    managedLinks.forEach((link) => {
        if (!link) return;
        const label = link.name || link.title || link.url || '링크';
        const li = document.createElement('li');
        const anchor = document.createElement('a');
        anchor.href = link.url || '#';
        anchor.target = '_blank';
        anchor.rel = 'noopener';
        anchor.className = 'link-with-icon';
        anchor.innerText = label;
        li.appendChild(anchor);
        linksEl.appendChild(li);
    });
}

function setSuperAdminStatus(message, tone = 'info') {
    const statusEl = document.getElementById('sa-status');
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.className = `status-banner ${tone}`;
}

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
    const adminEmailInput = document.getElementById('adminEmail');
    if (adminEmailInput) {
      adminEmailInput.value = '';
      adminEmailInput.removeAttribute('disabled');
    }
    document.getElementById('pageDescription').value = '';
    document.getElementById('pagePhoto').value = '';
    document.getElementById('adminPassword').value = '';
    document.getElementById('plan').value = 'free';
    pageTheme = 'classic';
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
    applyThemeToScopes();
    renderThemeOptions();
    updateThemePreview();
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
    const adminEmail = document.getElementById('adminEmail')?.value?.trim() || '';
    const description = document.getElementById('pageDescription').value.trim();
    const photoUrl = document.getElementById('pagePhoto').value.trim();
    const adminPassword = document.getElementById('adminPassword').value;
    const plan = document.getElementById('plan').value || 'free';

    if (!editingPageId && ((!rawSlug && !normalizedSlug) || !adminPassword || !adminEmail)) {
        alert('슬러그, 관리자 이메일, 관리자 비밀번호는 필수 입력입니다.');
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
    adminEmail: adminEmail || undefined,
    adminPassword: adminPassword || undefined,
    plan: plan,
    slugs,
    theme: pageTheme,
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
        setSuperAdminStatus(editingPageId ? '페이지가 수정되었습니다.' : '페이지가 생성되었습니다.', 'success');
        resetForm();
        loadPageList();  // 페이지 목록 갱신
    } else {
        const errText = await res.text();
        setSuperAdminStatus(`페이지 저장 실패: ${errText || res.status}`, 'error');
        alert(`페이지 저장 실패: ${errText || res.status}`);
    }
}

// 페이지 목록 불러오기 (검색/페이지네이션 지원)
async function loadPageList(page = pageListState.page) {
    const token = sessionStorage.getItem('super_admin_token');
    if (!token) {
        setSuperAdminStatus('슈퍼 관리자 토큰이 없습니다. 로그인 후 목록을 확인하세요.', 'error');
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
        setSuperAdminStatus(`페이지 목록 불러오기 실패: ${errText || res.status}`, 'error');
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
    setSuperAdminStatus(`페이지 ${pageListState.page} / ${Math.max(1, Math.ceil((pageListState.total || 0) / pageListState.pageSize))} (총 ${pageListState.total}개)를 불러왔습니다.`, 'info');
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
    const slugTitle = slugLabel ? `슬러그: ${slugLabel}` : '';
    return `
        <li>
            <div class="page-meta">
                <strong title="${slugTitle}">${page.profile?.name || page.pageId}</strong>
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
        setSuperAdminStatus('페이지가 삭제되었습니다.', 'success');
        loadPageList();  // 페이지 목록 갱신
    } else {
        const errText = await res.text();
        setSuperAdminStatus(`페이지 삭제 실패: ${errText || res.status}`, 'error');
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
    setSuperAdminStatus(`페이지 정보를 불러오지 못했습니다: ${errText || res.status}`,'error');
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
  const adminEmailInput = document.getElementById('adminEmail');
  if (adminEmailInput) {
    adminEmailInput.value = '';
    adminEmailInput.setAttribute('disabled', 'true');
  }
  document.getElementById('pageDescription').value = page.profile?.description || '';
  document.getElementById('pagePhoto').value = page.profile?.photoUrl || '';
  document.getElementById('adminPassword').value = '';
  document.getElementById('plan').value = page.plan || 'free';
  pageTheme = typeof page.theme === 'string' ? page.theme : 'classic';
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
  applyThemeToScopes();
  renderThemeOptions();
  updateThemePreview();

    setSuperAdminStatus(`${page.pageId} 페이지를 편집합니다. 저장 시 관리자 비밀번호를 비워두면 기존 값을 유지합니다.`, 'info');

    const submitBtn = document.getElementById('submit-btn');
    if (submitBtn) submitBtn.innerText = '수정 저장';
  const cancelBtn = document.getElementById('cancel-edit-btn');
  if (cancelBtn) cancelBtn.style.display = 'inline-block';
}

document.addEventListener('DOMContentLoaded', () => {
    const token = sessionStorage.getItem('super_admin_token');
    if (!token) {
        setSuperAdminStatus('슈퍼 관리자 로그인이 필요합니다. 로그인 화면으로 이동합니다.', 'error');
        window.location.href = '/login.html';
        return;
    }
    setSuperAdminStatus('슈퍼 관리자 인증 토큰을 확인했습니다. 페이지 목록을 불러옵니다.', 'success');
    renderPlatformSelector();
    updatePlatformPrefix();
    setupSlugInputs();
    resetForm();
    applyThemeToScopes();
    renderThemeOptions();
    updateThemePreview();
    loadPageList();
    setupBulkUpload();

    const searchInput = document.getElementById('page-search');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            pageListState = { ...pageListState, search: e.target.value || '', page: 1 };
            loadPageList(1);
        });
    }

    const nameInput = document.getElementById('pageName');
    const descInput = document.getElementById('pageDescription');
    const photoInput = document.getElementById('pagePhoto');

    [nameInput, descInput, photoInput].forEach((input) => {
        if (!input) return;
        input.addEventListener('input', () => updateThemePreview());
    });
});

function setupBulkUpload() {
  const fileInput = document.getElementById('bulk-file-input');
  if (fileInput) {
    fileInput.addEventListener('change', handleBulkFileInput);
  }

  updateBulkUploadButtons();
}

function updateBulkUploadButtons() {
  const uploadBtn = document.getElementById('bulk-upload-btn');
  if (uploadBtn) {
    uploadBtn.disabled = !bulkUploadPages.length;
  }
}

async function handleBulkFileInput(event) {
  const file = event.target?.files?.[0];
  const previewEl = document.getElementById('bulk-preview');

  if (!file) {
    bulkUploadPages = [];
    bulkPreviewMeta = { filename: '', totalRows: 0, skipped: 0 };
    renderBulkPreview();
    updateBulkUploadButtons();
    return;
  }

  if (previewEl) {
    previewEl.innerText = '파일을 읽는 중입니다...';
  }

  try {
    const rows = await readBulkWorkbook(file);
    const normalized = rows
      .map((row, idx) => normalizeBulkRow(row, idx + 1))
      .filter(Boolean);

    bulkUploadPages = normalized;
    bulkPreviewMeta = {
      filename: file.name,
      totalRows: rows.length,
      skipped: rows.length - normalized.length,
    };
    renderBulkPreview();
  } catch (error) {
    bulkUploadPages = [];
    bulkPreviewMeta = { filename: file.name, totalRows: 0, skipped: 0 };
    if (previewEl) {
      previewEl.innerText = `업로드 실패: ${error?.message || error}`;
    }
  }

  updateBulkUploadButtons();
}

async function readBulkWorkbook(file) {
  const buffer = await file.arrayBuffer();
  if (typeof XLSX !== 'undefined' && typeof XLSX.read === 'function') {
    const workbook = XLSX.read(buffer, { type: 'array' });
    const firstSheetName = workbook.SheetNames?.[0];
    if (!firstSheetName) return [];
    const sheet = workbook.Sheets[firstSheetName];
    const json = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    return Array.isArray(json) ? json : [];
  }

  const text = new TextDecoder().decode(buffer);
  return parseCsvRows(text);
}

function parseCsvRows(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];

  const headers = lines[0].split(',').map((value) => value.trim());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    const row = {};
    headers.forEach((header, idx) => {
      row[header] = parts[idx] ?? '';
    });
    rows.push(row);
  }

  return rows;
}

function normalizeBulkRow(row, rowNumber) {
  if (!row || typeof row !== 'object') return null;

  const pageId = selectCellValue(row, ['pageId', 'page_id', 'slug', '슬러그', '페이지ID']);
  const adminEmail = selectCellValue(row, ['adminEmail', 'email', '관리자이메일']);
  const adminPassword = selectCellValue(row, ['adminPassword', 'password', 'admin_password', '관리자비밀번호']);

  if (!pageId || !adminPassword || !adminEmail) {
    console.warn(`행 ${rowNumber}: pageId, 관리자 이메일 또는 관리자 비밀번호가 없어 건너뜁니다.`);
    return null;
  }

  const name = selectCellValue(row, ['name', '제목', '페이지이름']);
  const description = selectCellValue(row, ['description', '설명']);
  const photoUrl = selectCellValue(row, ['photoUrl', 'photo_url', '사진', '사진URL']);
  const plan = selectCellValue(row, ['plan', '요금제']);
  const theme = selectCellValue(row, ['theme', '테마']);
  const slugCell = row.slugs ?? row['슬러그들'] ?? row['slugs[]'];
  const linksCell = row.links ?? row['링크'] ?? row['links[]'];

  return {
    pageId: String(pageId).trim(),
    adminEmail: String(adminEmail).trim(),
    adminPassword: String(adminPassword).trim(),
    profile: { name: name || '', description: description || '', photoUrl: photoUrl || '' },
    plan: plan || null,
    theme: theme || null,
    slugs: parseSlugCell(slugCell),
    links: parseLinksCell(linksCell),
  };
}

function selectCellValue(row, keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim()) {
      return row[key];
    }
  }
  return '';
}

function parseSlugCell(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split(/[,\n]/)
      .map((v) => v.trim())
      .filter(Boolean);
  }

  return [];
}

function parseLinksCell(value) {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value.filter((item) => item && item.name && item.url);
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.filter((item) => item && item.name && item.url);
      }
    } catch (err) {
      // fallback to manual parsing
    }

    return value
      .split(/\n|;/)
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .map((chunk) => {
        const [name, url, iconUrl] = chunk.split('|').map((part) => part.trim());
        if (!name || !url) return null;
        return { name, url, iconUrl };
      })
      .filter(Boolean);
  }

  return [];
}

function renderBulkPreview() {
  const previewEl = document.getElementById('bulk-preview');
  if (!previewEl) return;

  if (!bulkUploadPages.length) {
    previewEl.innerText = '엑셀 파일을 선택하면 업로드 대상이 미리보기로 표시됩니다.';
    return;
  }

  const { filename, totalRows, skipped } = bulkPreviewMeta;
  const sample = bulkUploadPages.slice(0, 5);

  let html = `<strong>${filename || '선택한 파일'}</strong>에서 ${totalRows}개 행을 읽었습니다. `;
  html += `<span class="eyebrow">${bulkUploadPages.length}개 생성 준비</span>`;
  if (skipped) {
    html += ` · ${skipped}개 행은 필수 정보(pageId/관리자 이메일/비밀번호) 누락으로 건너뜀`;
  }

  html += '<table><thead><tr><th>#</th><th>pageId</th><th>링크 수</th><th>추가 슬러그</th><th>요금제</th><th>테마</th></tr></thead><tbody>';
  sample.forEach((page, idx) => {
    html += `<tr><td>${idx + 1}</td><td>${page.pageId}</td><td>${page.links?.length || 0}</td><td>${page.slugs?.length || 0}</td><td>${page.plan || '-'} </td><td>${page.theme || '-'} </td></tr>`;
  });
  html += '</tbody></table>';

  if (bulkUploadPages.length > sample.length) {
    html += `<p class="help-text">추가로 ${bulkUploadPages.length - sample.length}개 행이 더 있습니다.</p>`;
  }

  previewEl.innerHTML = html;
}

function resetBulkUpload() {
  bulkUploadPages = [];
  bulkPreviewMeta = { filename: '', totalRows: 0, skipped: 0 };
  const fileInput = document.getElementById('bulk-file-input');
  if (fileInput) {
    fileInput.value = '';
  }
  renderBulkPreview();
  updateBulkUploadButtons();
}

async function submitBulkUpload() {
  if (!bulkUploadPages.length) {
    alert('업로드할 데이터가 없습니다. 엑셀 파일을 먼저 선택하세요.');
    return;
  }

  const token = sessionStorage.getItem('super_admin_token');
  if (!token) {
    alert('슈퍼 관리자 로그인이 필요합니다.');
    return;
  }

  const res = await apiFetch('/api/admin/pages/import', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ pages: bulkUploadPages }),
  });

  if (!res.ok) {
    const errText = await res.text();
    alert(`업로드 실패: ${errText || res.status}`);
    return;
  }

  const result = await res.json();
  const summary = result?.summary;

  alert(`업로드 완료: ${summary?.success || 0}개 성공, ${summary?.failed || 0}개 실패`);
  resetBulkUpload();
  loadPageList();
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
            if (listType === 'super-admin-links') {
                moveSuperAdminLink(dragState.from, targetIndex - dragState.from);
            }
        }
        li.classList.remove('drag-over');
        li.dataset.direction = '';
        li.parentElement?.classList.remove('drag-active');
    });
}

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
  const target = typeof direction === 'number' ? index + direction : direction;
  reorderList(managedLinks, index, target);
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

        attachDragHandlers(li, index, 'super-admin-links');

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

  updateThemePreview();
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
