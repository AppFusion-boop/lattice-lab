export class ApiError extends Error {
  status: number;
  code: string;
  field?: string;

  constructor(status: number, code: string, message: string, field?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (res.ok) {
    if (res.status === 204) {
      return null as T;
    }
    const contentType = res.headers.get("content-type");
    if (contentType && contentType.includes("application/json")) {
      return (await res.json()) as T;
    }
    return (await res.text()) as unknown as T;
  }

  let code = "http_error";
  let message = `HTTP ${res.status}: ${res.statusText}`;
  let field: string | undefined;

  try {
    const errorBody = await res.json();
    if (errorBody && typeof errorBody === "object") {
      const detail = errorBody.detail;
      if (typeof detail === "object" && detail !== null) {
        code = detail.code || code;
        message = detail.message || message;
        field = detail.field;
      } else if (typeof detail === "string") {
        message = detail;
      }
    }
  } catch {
    // Non-JSON error body fallback
  }

  throw new ApiError(res.status, code, message, field);
}

export async function apiGet<T>(path: string, options?: RequestInit): Promise<T> {
  const url = path.startsWith("http") || path.startsWith("/api") ? path : `/api/v1${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      ...options?.headers,
    },
    ...options,
  });
  return handleResponse<T>(res);
}

export async function apiPost<T>(path: string, body?: unknown, options?: RequestInit): Promise<T> {
  const url = path.startsWith("http") || path.startsWith("/api") ? path : `/api/v1${path.startsWith("/") ? path : `/${path}`}`;
  const isFormData = body instanceof FormData;
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(options?.headers as Record<string, string>),
  };
  if (!isFormData && body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: isFormData ? (body as FormData) : body !== undefined ? JSON.stringify(body) : undefined,
    ...options,
  });
  return handleResponse<T>(res);
}

export async function apiPatch<T>(path: string, body?: unknown, options?: RequestInit): Promise<T> {
  const url = path.startsWith("http") || path.startsWith("/api") ? path : `/api/v1${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...options?.headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    ...options,
  });
  return handleResponse<T>(res);
}

export async function apiDelete<T>(path: string, options?: RequestInit): Promise<T> {
  const url = path.startsWith("http") || path.startsWith("/api") ? path : `/api/v1${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: {
      Accept: "application/json",
      ...options?.headers,
    },
    ...options,
  });
  return handleResponse<T>(res);
}
