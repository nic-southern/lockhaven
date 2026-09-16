export async function postJson<T>(
  url: string,
  body: unknown
): Promise<{ status: number; data: T }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  let data: T
  try {
    data = text ? (JSON.parse(text) as T) : ({} as T)
  } catch {
    throw new Error(`Unexpected response from ${url}`)
  }
  return { status: response.status, data }
}
