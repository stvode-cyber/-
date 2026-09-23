import type { Response } from 'express'

interface SSEConnection {
  userId: string
  res: Response
  connectedAt: number
}

class SSEManager {
  private connections = new Map<string, Set<SSEConnection>>()

  addConnection(userId: string, res: Response): () => void {
    const conn: SSEConnection = { userId, res, connectedAt: Date.now() }

    if (!this.connections.has(userId)) {
      this.connections.set(userId, new Set())
    }
    this.connections.get(userId)!.add(conn)

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    res.write(': connected\n\n')

    const heartbeat = setInterval(() => {
      try {
        res.write(': ping\n\n')
      } catch {
        clearInterval(heartbeat)
      }
    }, 30000)

    return () => {
      clearInterval(heartbeat)
      this.connections.get(userId)?.delete(conn)
      if (this.connections.get(userId)?.size === 0) {
        this.connections.delete(userId)
      }
    }
  }

  pushToUser(userId: string, event: string, data: unknown) {
    const conns = this.connections.get(userId)
    if (!conns || conns.size === 0) return

    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    for (const conn of conns) {
      try {
        conn.res.write(payload)
      } catch {
        conns.delete(conn)
      }
    }
  }

  getUserConnectionCount(userId: string): number {
    return this.connections.get(userId)?.size || 0
  }
}

export const sseManager = new SSEManager()
