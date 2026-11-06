/**
 * Token bucket en memoria (por socket). Permite ráfagas cortas y limita el ritmo
 * sostenido. Con varias instancias, el límite global debe vivir en Redis.
 */
export function createTokenBucket({ capacity, refillPerSecond }: { capacity: number; refillPerSecond: number }) {
  let tokens = capacity;
  let lastRefill = Date.now();

  return {
    take(cost = 1): boolean {
      const now = Date.now();
      tokens = Math.min(capacity, tokens + ((now - lastRefill) / 1000) * refillPerSecond);
      lastRefill = now;
      if (tokens < cost) return false;
      tokens -= cost;
      return true;
    },
  };
}
