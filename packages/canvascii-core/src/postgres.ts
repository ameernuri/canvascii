type PostgresPoolConfig = {
  connectionString: string
  ssl?: {
    rejectUnauthorized: boolean
  }
}

function shouldUseTlsRelaxedVerification(databaseUrl: string): boolean {
  let parsed: URL

  try {
    parsed = new URL(databaseUrl)
  } catch {
    return false
  }

  const sslmode = parsed.searchParams.get('sslmode')?.toLowerCase()
  if (!sslmode) {
    return false
  }

  return !['disable', 'allow', 'prefer'].includes(sslmode)
}

export function createCanvasciiPostgresConfig(databaseUrl: string): PostgresPoolConfig {
  return shouldUseTlsRelaxedVerification(databaseUrl)
    ? {
        connectionString: databaseUrl,
        ssl: {
          rejectUnauthorized: false,
        },
      }
    : {
        connectionString: databaseUrl,
      }
}
