const API_BASE = "https://infl-worker.loto09090909.workers.dev";

// 페이지 생성 함수
async function createPage() {
    const name = document.getElementById('pageName').value;
    const slug = document.getElementById('pageSlug').value;
    const description = document.getElementById('pageDescription').value;
    const photoUrl = document.getElementById('pagePhoto').value;
    const adminPassword = document.getElementById('adminPassword').value;

    const data = {
        pageId: slug,
        profile: {
            name: name,
            description: description,
            photoUrl: photoUrl
        },
        adminPassword: adminPassword,
        plan: "free"  // 기본적으로 무료로 설정
    };

    const token = sessionStorage.getItem('super_admin_token');
    if (!token) {
        alert('슈퍼 관리자 로그인이 필요합니다. 로그인 후 다시 시도하세요.');
        return;
    }

    const res = await fetch(`${API_BASE}/api/admin/pages`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(data)
    });

    if (res.ok) {
        alert('페이지가 생성되었습니다.');
        loadPageList();  // 페이지 목록 갱신
    } else {
        alert('페이지 생성 실패');
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
            ${page.profile?.name || page.pageId} - ${page.pageId}
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
        alert('페이지 삭제 실패');
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

    // 수정된 내용을 입력할 수 있도록 설정하는 부분
    document.getElementById('pageName').value = page.profile?.name || '';
    document.getElementById('pageSlug').value = page.pageId;
    document.getElementById('pageDescription').value = page.profile?.description || '';
    document.getElementById('pagePhoto').value = page.profile?.photoUrl || '';
    document.getElementById('adminPassword').value = "";  // 비밀번호는 수정하지 않음
}

document.addEventListener('DOMContentLoaded', () => {
    const token = sessionStorage.getItem('super_admin_token');
    if (!token) {
        window.location.href = '/login.html';
        return;
    }
    loadPageList();
});
