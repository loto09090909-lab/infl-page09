const MAX_LINKS = 100;
const MAX_CONTACT_FIELDS = 50;
const MAX_OPTIONS = 50;
const ALLOWED_THEMES = new Set(["classic", "midnight", "sunset", "mint"]);

function sanitizeString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (error) {
    return false;
  }
}

export function validateProfile(profile: unknown) {
  if (profile === undefined) return { profile: undefined };
  if (!profile || typeof profile !== "object") {
    return { error: "profile은 객체여야 합니다" };
  }

  const name = sanitizeString((profile as any).name, 120);
  const description = sanitizeString((profile as any).description, 500);
  const photoUrl = sanitizeString((profile as any).photoUrl, 500);

  if (photoUrl && !isHttpUrl(photoUrl)) {
    return { error: "photoUrl은 http(s) URL이어야 합니다" };
  }

  return {
    profile: {
      ...(name ? { name } : {}),
      ...(description ? { description } : {}),
      ...(photoUrl ? { photoUrl } : {}),
    },
  };
}

export function validateLinks(rawLinks: unknown, defaultPrivate = false) {
  if (rawLinks === undefined) return { publicLinks: undefined, privateLinks: undefined, provided: false };
  if (!Array.isArray(rawLinks)) {
    return { error: "links는 배열이어야 합니다" };
  }

  if (rawLinks.length > MAX_LINKS) {
    return { error: "링크가 너무 많습니다" };
  }

  const publicLinks: any[] = [];
  const privateLinks: any[] = [];

  for (const rawLink of rawLinks) {
    if (!rawLink || typeof rawLink !== "object") continue;
    const title = sanitizeString((rawLink as any).title ?? (rawLink as any).name, 120);
    const url = sanitizeString((rawLink as any).url, 1000);
    const iconUrl = sanitizeString((rawLink as any).iconUrl, 500);
    const platformId = sanitizeString((rawLink as any).platformId, 120);
    const handle = sanitizeString((rawLink as any).handle, 200);
    const isPrivate =
      (rawLink as any).isPrivate === true || (rawLink as any).private === true || defaultPrivate;

    if (!title || !url) continue;
    if (!isHttpUrl(url)) {
      return { error: "링크 URL은 http(s)여야 합니다" };
    }

    const cleaned = {
      title,
      url,
      ...(iconUrl && isHttpUrl(iconUrl) ? { iconUrl } : {}),
      ...(platformId ? { platformId } : {}),
      ...(handle ? { handle } : {}),
      ...(isPrivate ? { isPrivate: true } : {}),
    };

    if (isPrivate) {
      privateLinks.push(cleaned);
    } else {
      publicLinks.push(cleaned);
    }
  }

  return { publicLinks, privateLinks, provided: true };
}

export function validateContactSchema(raw: unknown) {
  if (raw === undefined) return { schema: undefined, provided: false };
  if (!Array.isArray(raw)) return { error: "contactSchema는 배열이어야 합니다" };
  if (raw.length > MAX_CONTACT_FIELDS) return { error: "contactSchema 항목이 너무 많습니다" };

  const allowedTypes = new Set(["text", "email", "tel", "url", "textarea", "select", "checkbox"]);

  const schema = raw
    .map((field) => {
      if (!field || typeof field !== "object") return null;
      const label = sanitizeString((field as any).label, 120);
      const type = sanitizeString((field as any).type, 30);
      const placeholder = sanitizeString((field as any).placeholder, 200);
      const helpText = sanitizeString((field as any).helpText, 400);
      const required = (field as any).required === true;
      const optionsRaw = Array.isArray((field as any).options) ? (field as any).options : [];
      const options = optionsRaw
        .map((opt) => sanitizeString(opt, 200))
        .filter((opt) => !!opt)
        .slice(0, MAX_OPTIONS);

      if (!label || !type || !allowedTypes.has(type)) return null;
      if ((type === "select" || type === "checkbox") && options.length === 0) return null;
      return {
        label,
        type,
        ...(placeholder ? { placeholder } : {}),
        ...(helpText ? { helpText } : {}),
        ...(required ? { required: true } : {}),
        ...(options.length ? { options } : {}),
      };
    })
    .filter(Boolean);

  return { schema, provided: true };
}

export function validateContactSettings(raw: unknown) {
  if (raw === undefined) return { settings: undefined };
  if (!raw || typeof raw !== "object") {
    return { error: "contactSettings는 객체여야 합니다" };
  }

  const webhookUrl = sanitizeString((raw as any).webhookUrl, 1000);
  const webhookUrlsRaw = Array.isArray((raw as any).webhookUrls) ? (raw as any).webhookUrls : [];
  const webhookUrls = webhookUrlsRaw
    .map((url) => sanitizeString(url, 1000))
    .filter((url): url is string => !!url);
  const emailRecipientsRaw = Array.isArray((raw as any).emailRecipients)
    ? (raw as any).emailRecipients
    : [];
  const emailRecipients = emailRecipientsRaw
    .map((email) => sanitizeString(email, 254))
    .filter((email): email is string => !!email);
  const enabled = (raw as any).enabled === true;
  const formTitle = sanitizeString((raw as any).formTitle, 120);
  const formDescription = sanitizeString((raw as any).formDescription, 400);
  const consentText = sanitizeString((raw as any).consentText, 200);
  const consentRequired = (raw as any).consentRequired === true;
  const emailSubject = sanitizeString((raw as any).emailSubject, 120);
  if (webhookUrl && !isHttpUrl(webhookUrl)) {
    return { error: "webhookUrl은 http(s)여야 합니다" };
  }
  const invalidWebhook = webhookUrls.find((url) => !isHttpUrl(url));
  if (invalidWebhook) {
    return { error: "webhookUrls는 http(s)여야 합니다" };
  }
  const invalidEmail = emailRecipients.find((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
  if (invalidEmail) {
    return { error: "emailRecipients는 유효한 이메일 주소여야 합니다" };
  }

  return {
    settings: {
      ...(enabled ? { enabled: true } : { enabled: false }),
      ...(webhookUrl ? { webhookUrl } : {}),
      ...(webhookUrls.length ? { webhookUrls } : {}),
      ...(emailRecipients.length ? { emailRecipients } : {}),
      ...(emailSubject ? { emailSubject } : {}),
      ...(formTitle ? { formTitle } : {}),
      ...(formDescription ? { formDescription } : {}),
      ...(consentText ? { consentText } : {}),
      ...(consentRequired ? { consentRequired: true } : {}),
    },
  };
}

export function validateAccessControl(raw: unknown) {
  if (raw === undefined) return { accessControl: undefined };
  if (!raw || typeof raw !== "object") {
    return { error: "accessControl은 객체여야 합니다" };
  }

  const enabled = (raw as any).enabled === true;
  const code = sanitizeString((raw as any).code, 80);

  if (enabled && !code) {
    return { error: "accessControl.enabled가 true이면 code가 필요합니다" };
  }

  return {
    accessControl: {
      enabled,
      ...(code ? { code } : {}),
    },
  };
}

function isEmail(value: string): boolean {
  // A simple regex, consider a more robust one for production
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function validateSignupBody(raw: unknown) {
  if (!raw || typeof raw !== "object") {
    return { error: "요청 본문이 필요합니다" };
  }

  const body = raw as Record<string, unknown>;
  const email = sanitizeString(body.email, 254);

  if (!email || !isEmail(email)) {
    return { error: "유효한 이메일을 입력하세요" };
  }

  const oauthProvider = sanitizeString(body.oauthProvider, 50);
  const oauthId = sanitizeString(body.oauthId, 100);
  const isOAuth = !!(oauthProvider && oauthId);

  const password = typeof body.password === "string" ? body.password.trim() : undefined;

  if (!isOAuth && (!password || password.length < 8)) {
    return { error: "비밀번호는 8자 이상이어야 합니다" };
  }

  return {
    data: {
      email,
      ...(password && !isOAuth ? { password } : {}),
      ...(isOAuth ? { oauthProvider, oauthId } : {}),
    },
  };
}

const MAX_FIELD_LENGTH = 2000;

export function validateContactSubmission(
  schema: any[],
  rawAnswers: unknown
): { error?: string; answers?: { label: string; type: string; value: string }[] } {
  if (!Array.isArray(rawAnswers)) {
    return { error: "answers는 배열이어야 합니다" };
  }

  const errors: string[] = [];
  const answers = schema
    .map((field) => {
      const raw = rawAnswers.find((item: any) => item?.label === field.label);
      const value = sanitizeString(raw?.value, MAX_FIELD_LENGTH) || "";

      if (field.required && !value) {
        errors.push(`${field.label}을(를) 입력해주세요.`);
        return null;
      }

      if (!value) return null;

      if (field.type === "email" && !isEmail(value)) {
        errors.push(`${field.label}이 올바른 이메일 형식이 아닙니다.`);
        return null;
      }

      if (field.type === "tel" && value.replace(/[^0-9+\-]/g, "").length < 6) {
        errors.push(`${field.label}이 올바른 전화번호 형식인지 확인해주세요.`);
        return null;
      }

      if (field.type === "url" && !isHttpUrl(value)) {
        errors.push(`${field.label}은 http(s) URL이어야 합니다.`);
        return null;
      }

      if (
        (field.type === "select" || field.type === "checkbox") &&
        Array.isArray(field.options) &&
        field.options.length
      ) {
        const selections = value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
        const invalid = selections.find((item) => !field.options!.includes(item));
        if (invalid) {
          errors.push(`${field.label} 값이 허용된 옵션에 없습니다: ${invalid}`);
          return null;
        }
      }

      return {
        label: field.label,
        type: field.type,
        value,
      };
    })
    .filter(Boolean) as { label: string; type: string; value: string }[];

  if (errors.length) {
    return { error: errors.join(" ") };
  }

  return { answers };
}

export function validateTheme(raw: unknown) {
  if (raw === undefined) return { theme: undefined };
  if (typeof raw !== "string") return { error: "theme은 문자열이어야 합니다" };


  const trimmed = raw.trim();
  if (!trimmed) return { theme: "classic" };
  if (!ALLOWED_THEMES.has(trimmed)) {
    return { error: "지원하지 않는 테마입니다" };
  }

  return { theme: trimmed };
}
