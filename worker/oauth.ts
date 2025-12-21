import { createSessionToken, hasSessionSecret } from "./auth";
import { errorResponse, jsonResponse } from "./utils";
import { findOrCreateOAuthUser } from "./users";

type OAuthProvider = "google" | "naver";

const STATE_TTL_SECONDS = 600;

function normalizeProvider(provider: string | undefined): OAuthProvider | null {
  if (provider === "google" || provider === "naver") return provider;
  return null;
}

function getRedirectBase(env: any) {
  return env.OAUTH_REDIRECT_BASE || env.PUBLIC_BASE_URL || null;
}

function buildRedirectUri(env: any, provider: OAuthProvider) {
  const base = getRedirectBase(env);
  if (!base) return null;
  return `${String(base).replace(/\/+$/, "")}/api/auth/${provider}/callback`;
}

function getOAuthConfig(env: any, provider: OAuthProvider) {
  if (provider === "google") {
    return {
      clientId: env.OAUTH_GOOGLE_CLIENT_ID,
      clientSecret: env.OAUTH_GOOGLE_CLIENT_SECRET,
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scope: "openid email profile",
    };
  }
  return {
    clientId: env.OAUTH_NAVER_CLIENT_ID,
    clientSecret: env.OAUTH_NAVER_CLIENT_SECRET,
    authorizeUrl: "https://nid.naver.com/oauth2.0/authorize",
    tokenUrl: "https://nid.naver.com/oauth2.0/token",
    scope: "profile email",
  };
}

function parseRedirect(url: URL, env: any): string | null {
  const redirect = url.searchParams.get("redirect");
  if (!redirect) return null;
  try {
    const parsed = new URL(redirect);
    const allowed = (env.ALLOWED_ORIGINS || "")
      .split(",")
      .map((value: string) => value.trim())
      .filter(Boolean);
    if (!allowed.length || allowed.includes("*")) {
      return parsed.toString();
    }
    if (allowed.includes(parsed.origin)) {
      return parsed.toString();
    }
  } catch (error) {
    return null;
  }
  return null;
}

async function storeState(env: any, state: string, payload: Record<string, unknown>) {
  await env.PAGE_KV.put(`oauth:state:${state}`, JSON.stringify(payload), {
    expirationTtl: STATE_TTL_SECONDS,
  });
}

async function readState(env: any, state: string) {
  const raw = await env.PAGE_KV.get(`oauth:state:${state}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

async function clearState(env: any, state: string) {
  await env.PAGE_KV.delete(`oauth:state:${state}`);
}

export async function startOAuth(
  req: Request,
  env: any,
  headers: HeadersInit,
  providerInput: string
) {
  const provider = normalizeProvider(providerInput);
  if (!provider) {
    return errorResponse("지원하지 않는 OAuth 제공자입니다", 400, headers);
  }

  const config = getOAuthConfig(env, provider);
  const redirectUri = buildRedirectUri(env, provider);
  if (!config.clientId || !config.clientSecret || !redirectUri) {
    return errorResponse("OAuth 설정이 누락되었습니다", 500, headers);
  }

  const state = crypto.randomUUID();
  const url = new URL(req.url);
  const redirect = parseRedirect(url, env);
  await storeState(env, state, { provider, redirect, createdAt: Date.now() });

  const authUrl = new URL(config.authorizeUrl);
  authUrl.searchParams.set("client_id", config.clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("scope", config.scope);
  if (provider === "google") {
    authUrl.searchParams.set("prompt", "select_account");
    authUrl.searchParams.set("access_type", "online");
  }

  return new Response(null, {
    status: 302,
    headers: {
      ...headers,
      Location: authUrl.toString(),
    },
  });
}

async function exchangeToken(
  env: any,
  provider: OAuthProvider,
  code: string,
  redirectUri: string
) {
  const config = getOAuthConfig(env, provider);
  if (!config.clientId || !config.clientSecret) {
    throw new Error("OAuth 설정이 누락되었습니다");
  }

  const params = new URLSearchParams();
  params.set("grant_type", "authorization_code");
  params.set("client_id", config.clientId);
  params.set("client_secret", config.clientSecret);
  params.set("code", code);
  params.set("redirect_uri", redirectUri);

  const res = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`OAuth token exchange failed: ${detail}`);
  }

  return res.json<any>();
}

async function fetchUserProfile(provider: OAuthProvider, token: string) {
  if (provider === "google") {
    const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error("Google userinfo fetch failed");
    }
    return res.json<any>();
  }

  const res = await fetch("https://openapi.naver.com/v1/nid/me", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error("Naver userinfo fetch failed");
  }
  return res.json<any>();
}

function normalizeOAuthProfile(provider: OAuthProvider, profile: any) {
  if (provider === "google") {
    return {
      email: profile?.email,
      oauthId: profile?.sub || profile?.id,
    };
  }

  const response = profile?.response || {};
  return {
    email: response?.email,
    oauthId: response?.id,
  };
}

export async function handleOAuthCallback(
  req: Request,
  env: any,
  headers: HeadersInit,
  providerInput: string
) {
  const provider = normalizeProvider(providerInput);
  if (!provider) {
    return errorResponse("지원하지 않는 OAuth 제공자입니다", 400, headers);
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    return errorResponse("OAuth 응답이 올바르지 않습니다", 400, headers);
  }

  const stored = await readState(env, state);
  await clearState(env, state);
  if (!stored || stored.provider !== provider) {
    return errorResponse("OAuth 상태값이 유효하지 않습니다", 400, headers);
  }

  const redirectUri = buildRedirectUri(env, provider);
  if (!redirectUri) {
    return errorResponse("OAuth 리다이렉트 설정이 누락되었습니다", 500, headers);
  }

  const tokenPayload = await exchangeToken(env, provider, code, redirectUri);
  const accessToken = tokenPayload?.access_token;
  if (!accessToken) {
    return errorResponse("OAuth 토큰을 가져오지 못했습니다", 500, headers);
  }

  const profile = await fetchUserProfile(provider, accessToken);
  const normalized = normalizeOAuthProfile(provider, profile);
  if (!normalized.email || !normalized.oauthId) {
    return errorResponse("OAuth 프로필에서 이메일을 확인할 수 없습니다", 400, headers);
  }

  let user;
  try {
    user = await findOrCreateOAuthUser(env, {
      email: normalized.email,
      oauthProvider: provider,
      oauthId: normalized.oauthId,
    });
  } catch (error: any) {
    return errorResponse(error?.message || "OAuth 사용자 생성에 실패했습니다", 409, headers);
  }

  if (!hasSessionSecret(env)) {
    return errorResponse("TOKEN_SECRET 또는 SESSION_SECRET이 필요합니다.", 500, headers);
  }

  const session = await createSessionToken(env, "user", user.id);
  const redirect = stored.redirect;
  if (redirect) {
    const redirectUrl = new URL(redirect);
    redirectUrl.searchParams.set("token", session.token);
    redirectUrl.searchParams.set("expiresIn", session.expiresIn.toString());
    return new Response(null, {
      status: 302,
      headers: {
        ...headers,
        Location: redirectUrl.toString(),
      },
    });
  }

  return jsonResponse(
    { token: session.token, expiresIn: session.expiresIn, userId: user.id },
    200,
    headers
  );
}
