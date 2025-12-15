const API_BASE = window.API_BASE ?? window.location.origin;
let editingPageId = null;
let managedLinks = [];

function setFormTitle(titleText) {
    const titleEl = document.getElementById('form-title');
    if (titleEl) titleEl.innerText = titleText;
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
    renderSuperAdminLinks();
    setFormTitle('페이지 생성');
    const submitBtn = document.getElementById('submit-btn');
    if (submitBtn) submitBtn.innerText = '페이지 생성';
    const cancelBtn = document.getElementById('cancel-edit-btn');
    if (cancelBtn) cancelBtn.style.display = 'none';
}

// 페이지 생성/수정 함수
async function submitPage() {
    const name = document.getElementById('pageName').value.trim();
    const slug = document.getElementById('pageSlug').value.trim();
    const description = document.getElementById('pageDescription').value.trim();
    const photoUrl = document.getElementById('pagePhoto').value.trim();
    const adminPassword = document.getElementById('adminPassword').value;
    const plan = document.getElementById('plan').value || 'free';

    if (!editingPageId && (!slug || !adminPassword)) {
        alert('슬러그와 관리자 비밀번호는 필수 입력입니다.');
        return;
    }

    if (managedLinks.some(link => !link.name || !link.url)) {
        alert('모든 링크는 이름과 URL을 모두 입력해야 합니다.');
        return;
    }

    const data = {
        pageId: slug,
        profile: {
            name: name,
            description: description,
            photoUrl: photoUrl
        },
        links: managedLinks,
        adminPassword: adminPassword || undefined,
        plan: plan
    };

    const targetPageId = editingPageId || slug;
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
        ? `${API_BASE}/api/admin/pages/${encodeURIComponent(targetPageId)}`
        : `${API_BASE}/api/admin/pages`;

    const res = await fetch(endpoint, {
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

// 페이지 목록 불러오기
async function loadPageList() {
    const token = sessionStorage.getItem('super_admin_token');
    if (!token) {
        console.warn('슈퍼 관리자 토큰이 없습니다. 로그인 후 목록을 확인하세요.');
        return;
    }

    const res = await fetch(`${API_BASE}/api/admin/pages`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const pages = await res.json();

    const pageList = document.getElementById('pages');
    pageList.innerHTML = pages.map(page => `
        <li>
            <div class="page-meta">
                <strong>${page.profile?.name || page.pageId}</strong> (${page.pageId})
                <span class="plan-badge">플랜: ${page.plan || 'free'}</span>
            </div>
            <button onclick="editPage('${page.pageId}')">편집</button>
            <button onclick="deletePage('${page.pageId}')">삭제</button>
        </li>
    `).join('');
}

// 페이지 삭제
async function deletePage(pageId) {
    const token = sessionStorage.getItem('super_admin_token');
    if (!token) {
        alert('슈퍼 관리자 로그인이 필요합니다.');
        return;
    }

    const res = await fetch(`${API_BASE}/api/admin/pages/${pageId}`, {
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

    const res = await fetch(`${API_BASE}/api/admin/pages`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const pages = await res.json();
    const page = pages.find(p => p.pageId === pageId);

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
    managedLinks = Array.isArray(page.links) ? [...page.links] : [];
    renderSuperAdminLinks();
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
    resetForm();
    loadPageList();
});

function addSuperAdminLink() {
    const nameInput = document.getElementById('saLinkName');
    const urlInput = document.getElementById('saLinkUrl');

    const name = nameInput?.value?.trim();
    const url = urlInput?.value?.trim();

    if (!name || !url) {
        alert('링크 이름과 URL을 모두 입력하세요.');
        return;
    }

    managedLinks.push({ name, url });
    renderSuperAdminLinks();

    if (nameInput) nameInput.value = '';
    if (urlInput) urlInput.value = '';
}

function updateSuperAdminLink(index, field, value) {
    managedLinks[index] = { ...managedLinks[index], [field]: value };
}

function removeSuperAdminLink(index) {
    managedLinks.splice(index, 1);
    renderSuperAdminLinks();
}

function renderSuperAdminLinks() {
    const list = document.getElementById('sa-link-list');
    if (!list) return;

    list.innerHTML = '';

    managedLinks.forEach((link, index) => {
        const li = document.createElement('li');
        li.className = 'link-row';

        const nameInput = document.createElement('input');
        nameInput.placeholder = '링크 이름';
        nameInput.value = link.name || '';
        nameInput.oninput = (e) => updateSuperAdminLink(index, 'name', e.target.value);

        const urlInput = document.createElement('input');
        urlInput.placeholder = '링크 URL';
        urlInput.value = link.url || '';
        urlInput.oninput = (e) => updateSuperAdminLink(index, 'url', e.target.value);

        const removeBtn = document.createElement('button');
        removeBtn.innerText = '삭제';
        removeBtn.onclick = () => removeSuperAdminLink(index);

        li.appendChild(nameInput);
        li.appendChild(urlInput);
        li.appendChild(removeBtn);

        list.appendChild(li);
    });
}
