// 관리자 페이지: 페이지 저장
function savePage() {
    const name = document.getElementById('name').value;
    const desc = document.getElementById('desc').value;
    const photo = document.getElementById('photo').value;

    // API 호출로 페이지 정보 저장
    fetch('/api/pages/save', {
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
    fetch('/api/pages/save', {
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
    fetch('/api/pages/saveAds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adsEnabled: adsEnabled })
    }).then(response => response.json())
      .then(data => alert('광고 설정이 저장되었습니다.'))
      .catch(error => alert('광고 설정 실패: ' + error));
}
