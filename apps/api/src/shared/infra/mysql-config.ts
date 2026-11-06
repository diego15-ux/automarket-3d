import type { PoolConfig } from 'mariadb';

/**
 * DATABASE_URL (`mysql://user:pass@host:3306/db?ssl=true&connectionLimit=10`) → configuración
 * del pool `mariadb` que usa @prisma/adapter-mariadb (compatible con MySQL 8).
 * Módulo sin dependencias de `env` para poder usarlo también desde el seed.
 */
export function mysqlPoolConfig(databaseUrl: string, connectionLimit = 10): PoolConfig {
  const url = new URL(databaseUrl);
  if (url.protocol !== 'mysql:' && url.protocol !== 'mariadb:') {
    throw new Error('DATABASE_URL debe tener el formato mysql://usuario:clave@host:3306/base');
  }
  const ssl = url.searchParams.get('ssl') ?? url.searchParams.get('sslmode');
  const useTls = ssl !== null && !['false', '0', 'disable', 'disabled'].includes(ssl.toLowerCase());

  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.replace(/^\//, '')),
    connectionLimit: Number(url.searchParams.get('connectionLimit') ?? connectionLimit),
    ssl: useTls ? { rejectUnauthorized: true } : undefined,
    // MySQL 8 autentica con caching_sha2_password: sin TLS hay que pedir la clave RSA del servidor.
    allowPublicKeyRetrieval: !useTls,
    // Todas las fechas en UTC, también NOW()/CURRENT_TIMESTAMP de los DEFAULT.
    initSql: "SET time_zone = '+00:00'",
  };
}
