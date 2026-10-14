# Kromo Cargo — guía para agentes

- Runtime: Bun (`~/.bun/bin/bun`). Pruebas: `bun test`. Tipos: `bun run typecheck`. Ambos deben pasar antes de terminar.
- Toda la lógica de negocio vive en acciones (`defineAction`) dentro de `apps/cargo/src/actions/`; la UI y el MCP solo las llaman. No agregues endpoints ad hoc.
- `packages/core` no debe saber nada de inventario. Si algo solo lo usa esta app, se queda en `apps/cargo`.
- Nunca se borran filas de negocio: el stock es la suma de `movimientos`; los productos se archivan; deshacer registra movimientos inversos.
- Textos visibles (UI, errores, descripciones de herramientas MCP) en español de México.
- El SQL debe correr igual en SQLite y Postgres: usa `ahora()`/`hoy()` como parámetros, `CAST(COUNT(*) AS INTEGER)`, `positivo()` y `db.insert()`. Antes de terminar corre `bun test` y `bun run test:pg` (requiere `bun run db:up`).
- Usa `KROMO_DATA=/tmp/...` para no tocar los datos reales del usuario.
