type PostgresPoolConfig = {
  connectionString: string
  ssl?: {
    rejectUnauthorized: boolean
  }
}

function parseDatabaseUrl(databaseUrl: string): URL | null {
  try {
    return new URL(databaseUrl)
  } catch {
    return null
  }
}

function shouldUseTlsRelaxedVerification(parsed: URL | null): boolean {
  const sslmode = parsed?.searchParams.get('sslmode')?.toLowerCase()
  return Boolean(sslmode && !['disable', 'allow', 'prefer'].includes(sslmode))
}

export function createCanvasciiPostgresConfig(databaseUrl: string): PostgresPoolConfig {
  const parsed = parseDatabaseUrl(databaseUrl)

  if (shouldUseTlsRelaxedVerification(parsed)) {
    parsed?.searchParams.delete('sslmode')

    return {
      connectionString: parsed?.toString() ?? databaseUrl,
      ssl: {
        rejectUnauthorized: false,
      },
    }
  }

  return {
    connectionString: databaseUrl,
  }
}
