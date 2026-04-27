import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';

export async function proxyAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!config.proxySharedSecret) return;

  const authorization = request.headers.authorization ?? '';
  const expected = `Bearer ${config.proxySharedSecret}`;

  if (authorization !== expected) {
    await reply.code(401).send({ error: 'Unauthorized proxy request' });
  }
}
