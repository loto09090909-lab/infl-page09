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

    const res = await fetch("https://infl-worker.loto09090909.workers.dev/api/admin/pages", {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
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
    const res = await fetch("https://infl-worker.loto09090909.workers.dev/api/admin/pages");
    const pages = await res.json();

    const pageList = document.getElementById('pages');
    pageList.innerHTML = pages.map(page => `
        <li>
            ${page.name} - ${page.pageId}
            <button onclick="editPage('${page.pageId}')">편집</button>
            <button onclick="deletePage('${page.pageId}')">삭제</button>
        </li>
    `).join('');
}

// 페이지 삭제
async function deletePage(pageId) {
    const res = await fetch("https://infl-worker.loto09090909.workers.dev/api/admin/pages/${pageId}/delete", { method: 'POST' });

    if (res.ok) {
        alert('페이지가 삭제되었습니다.');
        loadPageList();  // 페이지 목록 갱신
    } else {
        alert('페이지 삭제 실패');
    }
}

// 페이지 수정
async function editPage(pageId) {
    // 수정할 페이지의 정보를 불러오고 수정 폼에 채워넣는 작업
    const res = await fetch("https://infl-worker.loto09090909.workers.dev/api/admin/pages/${pageId}");
    const page = await res.json();

    // 수정된 내용을 입력할 수 있도록 설정하는 부분
    document.getElementById('pageName').value = page.name;
    document.getElementById('pageSlug').value = page.pageId;
    document.getElementById('pageDescription').value = page.profile.description;
    document.getElementById('pagePhoto').value = page.profile.photoUrl;
    document.getElementById('adminPassword').value = "";  // 비밀번호는 수정하지 않음
}
