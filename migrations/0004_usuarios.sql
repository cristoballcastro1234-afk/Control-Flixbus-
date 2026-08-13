CREATE TABLE IF NOT EXISTS usuarios (
  usuario TEXT PRIMARY KEY,
  nombre TEXT NOT NULL DEFAULT '',
  -- Formato: pbkdf2$<iteraciones>$<salt_base64url>$<hash_base64url>
  -- Nunca se guarda la contraseña en texto plano.
  password_hash TEXT NOT NULL,
  rol TEXT NOT NULL DEFAULT 'operador',
  activo INTEGER NOT NULL DEFAULT 1,
  intentos_fallidos INTEGER NOT NULL DEFAULT 0,
  bloqueado_hasta TEXT NOT NULL DEFAULT '',
  creado_en TEXT NOT NULL
);
