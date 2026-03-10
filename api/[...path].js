const DEFAULT_BACKEND_URL = 'https://churnable-nimbly-norbert.ngrok-free.dev'

function buildTargetUrl(req) {
  const baseUrl = (process.env.BACKEND_BASE_URL || DEFAULT_BACKEND_URL).replace(/\/$/, '')
  
  // Para req.url = '/api/health?params=1', extraer 'health?params=1' después de '/api/'
  let pathAndQuery = (req.url || '').replace(/^\/api\//, '') || ''
  
  // Separar path de query string
  const [path, queryString] = pathAndQuery.split('?')
  
  // Si no hay path directo, intenta desde req.query.path (compatibilidad)
  const finalPath = path || (Array.isArray(req.query.path)
    ? req.query.path.join('/')
    : req.query.path || '')

  const params = new URLSearchParams()
  Object.entries(req.query || {}).forEach(([key, value]) => {
    if (key === 'path') return
    if (Array.isArray(value)) {
      value.forEach((v) => params.append(key, String(v)))
      return
    }
    if (value !== undefined && value !== null) {
      params.append(key, String(value))
    }
  })

  // Usar query string del req.url si existe, sino construir desde params
  const finalQuery = queryString || params.toString()
  return `${baseUrl}/${finalPath}${finalQuery ? `?${finalQuery}` : ''}`
}

function buildForwardHeaders(req) {
  const headers = {}
  Object.entries(req.headers || {}).forEach(([key, value]) => {
    const lower = key.toLowerCase()
    if (lower === 'host' || lower === 'content-length') return
    if (value !== undefined) headers[key] = value
  })

  // Required by ngrok to bypass browser warning/interstitial on proxied traffic.
  headers['ngrok-skip-browser-warning'] = 'true'
  return headers
}

async function readRequestBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined
  const chunks = []
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  if (!chunks.length) return undefined
  return Buffer.concat(chunks)
}

export default async function handler(req, res) {
  try {
    const targetUrl = buildTargetUrl(req)
    const body = await readRequestBody(req)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 25000)

    let upstream
    try {
      upstream = await fetch(targetUrl, {
        method: req.method,
        headers: buildForwardHeaders(req),
        body,
        redirect: 'follow',
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeout)
    }

    res.statusCode = upstream.status
    upstream.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'transfer-encoding') return
      res.setHeader(key, value)
    })

    const data = Buffer.from(await upstream.arrayBuffer())
    res.end(data)
  } catch (error) {
    const message = error && error.name === 'AbortError'
      ? 'Proxy timeout to backend'
      : 'Proxy request failed'

    res.statusCode = 502
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({
      error: message,
      details: error instanceof Error ? error.message : String(error),
    }))
  }
}
