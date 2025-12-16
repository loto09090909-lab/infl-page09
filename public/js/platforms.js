(function (global) {
  const PLATFORM_PRESETS = [
    {
      id: 'youtube',
      label: '유튜브',
      baseUrl: 'https://www.youtube.com/',
      iconPath: '/icon/youtube_icon.png',
      emoji: '▶️',
      placeholder: 'channel/@handle 또는 watch?v=',
    },
    {
      id: 'soop',
      label: '숲',
      baseUrl: 'https://www.sooplive.co.kr/station/',
      iconPath: '/icon/soop_icon.png',
      emoji: '🌲',
      placeholder: '방송국 ID',
    },
    {
      id: 'instagram',
      label: '인스타',
      baseUrl: 'https://www.instagram.com/',
      iconPath: '/icon/instagram_icon.png',
      emoji: '📸',
      placeholder: '@없이 계정 ID',
    },
    {
      id: 'chzzk',
      label: '치지직',
      baseUrl: 'https://chzzk.naver.com/',
      iconPath: '/icon/chzzk_icon.png',
      emoji: '🎮',
      placeholder: '채널 ID',
    },
    {
      id: 'naver-cafe',
      label: '네이버 카페',
      baseUrl: 'https://cafe.naver.com/',
      iconPath: '/icon/navercafe_icon.png',
      emoji: '☕',
      placeholder: '카페 경로',
    },
    {
      id: 'naver-blog',
      label: '네이버 블로그',
      baseUrl: 'https://blog.naver.com/',
      iconPath: '/icon/naverblog_icon.png',
      emoji: '📝',
      placeholder: '블로그 ID',
    },
    {
      id: 'facebook',
      label: '페이스북',
      baseUrl: 'https://www.facebook.com/',
      iconPath: '/icon/facebook_icon.png',
      emoji: '📘',
      placeholder: '페이지/프로필 ID',
    },
    {
      id: 'tiktok',
      label: '틱톡',
      baseUrl: 'https://www.tiktok.com/',
      iconPath: '/icon/tiktok_icon.png',
      emoji: '🎵',
      placeholder: '@없이 사용자 ID',
    },
    {
      id: 'twitch',
      label: '트위치',
      baseUrl: 'https://www.twitch.tv/',
      iconPath: '/icon/twitch_icon.png',
      emoji: '🟣',
      placeholder: '채널 ID',
    },
    {
      id: 'threads',
      label: '스레드',
      baseUrl: 'https://www.threads.com/',
      iconPath: '/icon/threads_icon.png',
      emoji: '🧵',
      placeholder: '@없이 사용자 ID',
    },
    {
      id: 'x',
      label: 'X',
      baseUrl: 'https://x.com/',
      iconPath: '/icon/x_icon.png',
      emoji: '✖️',
      placeholder: '@없이 사용자 ID',
    },
    {
      id: 'dcinside',
      label: '디시인사이드',
      baseUrl: 'https://gall.dcinside.com/',
      iconPath: '/icon/dcinside_icon.png',
      emoji: '💬',
      placeholder: '갤러리 경로',
    },
  ];

  function getPlatformPreset(platformId) {
    return PLATFORM_PRESETS.find((preset) => preset.id === platformId);
  }

  function buildPlatformUrl(preset, handle) {
    const cleanHandle = (handle || '').trim().replace(/^\/+/, '');
    return cleanHandle ? `${preset.baseUrl}${cleanHandle}` : '';
  }

  function inferPlatformFromLink(link) {
    for (const preset of PLATFORM_PRESETS) {
      if (link.platformId === preset.id) {
        return { preset, handle: link.handle || link.url?.replace(preset.baseUrl, '') || '' };
      }

      if (typeof link.url === 'string' && link.url.startsWith(preset.baseUrl)) {
        return { preset, handle: link.url.slice(preset.baseUrl.length) };
      }
    }

    return null;
  }

  global.PlatformHelpers = {
    PLATFORM_PRESETS,
    getPlatformPreset,
    buildPlatformUrl,
    inferPlatformFromLink,
  };
})(typeof window !== 'undefined' ? window : globalThis);
