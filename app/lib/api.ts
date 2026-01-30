type JsonResponse<T> = { ok: boolean; status: number; data: T };

async function requestJson<T>(
  url: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
  body?: any
): Promise<JsonResponse<T>> {
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export async function postJson<T>(url: string, body: any): Promise<JsonResponse<T>> {
  return requestJson<T>(url, "POST", body);
}

export async function getJson<T>(url: string): Promise<JsonResponse<T>> {
  return requestJson<T>(url, "GET");
}

export async function delJson<T>(url: string, body?: any): Promise<JsonResponse<T>> {
  return requestJson<T>(url, "DELETE", body);
}

export async function putJson<T>(url: string, body: any): Promise<JsonResponse<T>> {
  return requestJson<T>(url, "PUT", body);
}
