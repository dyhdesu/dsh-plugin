// board API:/api/ai-team/* 薄分发。数据权威态在 store;中断经 interrupt 协议。
// 安全边界(全仓库约定):不做 host 认证;写路由跨源防护以 Origin 同源比对为上限。
function sendJson(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload))
}

function rejectCrossOrigin(req, res) {
  const origin = req.headers ? req.headers.origin : undefined
  if (!origin) return false
  let sameOrigin = false
  try {
    sameOrigin = new URL(origin).host === req.headers.host
  } catch {
    sameOrigin = false
  }
  if (sameOrigin) return false
  sendJson(res, 403, { error: '跨源请求被拒绝' })
  return true
}

const BODY_LIMIT_BYTES = 64 * 1024

function readBody(req) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers?.['content-length'] ?? 0)
    if (declared > BODY_LIMIT_BYTES) {
      reject(Object.assign(new Error('请求体超过大小上限'), { statusCode: 413 }))
      return
    }
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > BODY_LIMIT_BYTES) {
        reject(Object.assign(new Error('请求体超过大小上限'), { statusCode: 413 }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

export function createBoardApi({ store, interrupt }) {
  async function handleBoard(req, res) {
    try {
      const [tasks, control] = await Promise.all([store.listAggregates(), store.loadControl()])
      sendJson(res, 200, { control, tasks })
    } catch (error) {
      sendJson(res, error.statusCode ?? 500, { error: error.message })
    }
  }

  async function handleInterrupt(req, res) {
    try {
      if (rejectCrossOrigin(req, res)) return
      const raw = await readBody(req).catch((error) => { throw Object.assign(error, { statusCode: error.statusCode ?? 400 }) })
      let body = {}
      try {
        body = raw ? JSON.parse(raw) : {}
      } catch {
        sendJson(res, 400, { error: '请求体不是合法 JSON' })
        return
      }
      const scope = body.global ? { global: true } : { taskId: body.taskId }
      if (!body.global && !scope.taskId) {
        sendJson(res, 400, { error: '缺少 taskId 或 global' })
        return
      }
      const result = await interrupt(scope)
      if (!result.accepted) {
        sendJson(res, 502, { accepted: false, error: result.error })
        return
      }
      sendJson(res, 200, { accepted: true, controlState: result.controlState })
    } catch (error) {
      sendJson(res, error.statusCode ?? 500, { error: error.message })
    }
  }

  return { handleBoard, handleInterrupt }
}
