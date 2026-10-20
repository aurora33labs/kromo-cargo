import type { MigrationSet } from "@kromo/core";

// SQL portable entre SQLite y Postgres ({{pk}} y {{ahora}} los traduce el núcleo).
// Dinero y cantidades en DOUBLE PRECISION; fechas como texto local "AAAA-MM-DD HH:MM:SS".
export const migraciones: MigrationSet = {
  modulo: "cargo",
  migraciones: [
    {
      version: 1,
      sql: `
        CREATE TABLE productos (
          id {{pk}},
          nombre TEXT NOT NULL,
          sku TEXT UNIQUE,
          codigo_barras TEXT UNIQUE,
          categoria TEXT,
          descripcion TEXT,
          precio DOUBLE PRECISION NOT NULL DEFAULT 0,
          costo DOUBLE PRECISION NOT NULL DEFAULT 0,
          unidad TEXT NOT NULL DEFAULT 'pieza',
          stock_minimo DOUBLE PRECISION NOT NULL DEFAULT 0,
          proveedor TEXT,
          notas TEXT,
          foto TEXT,
          activo INTEGER NOT NULL DEFAULT 1,
          creado_en TEXT NOT NULL DEFAULT {{ahora}},
          actualizado_en TEXT NOT NULL DEFAULT {{ahora}}
        );
        CREATE INDEX productos_categoria ON productos(categoria);

        CREATE TABLE ventas (
          id {{pk}},
          total DOUBLE PRECISION NOT NULL,
          metodo_pago TEXT NOT NULL,
          nota TEXT,
          anulada INTEGER NOT NULL DEFAULT 0,
          creado_en TEXT NOT NULL DEFAULT {{ahora}}
        );
        CREATE INDEX ventas_creado ON ventas(creado_en);

        -- Libro de movimientos: el stock es la suma de cantidad. Nunca se edita ni se borra.
        CREATE TABLE movimientos (
          id {{pk}},
          producto_id INTEGER NOT NULL REFERENCES productos(id),
          tipo TEXT NOT NULL CHECK (tipo IN ('inicial','entrada','venta','merma','ajuste','anulacion')),
          cantidad DOUBLE PRECISION NOT NULL,
          costo_unitario DOUBLE PRECISION,
          precio_unitario DOUBLE PRECISION,
          motivo TEXT,
          proveedor TEXT,
          venta_id INTEGER REFERENCES ventas(id),
          creado_en TEXT NOT NULL DEFAULT {{ahora}}
        );
        CREATE INDEX movimientos_producto ON movimientos(producto_id, creado_en);
        CREATE INDEX movimientos_venta ON movimientos(venta_id);

        CREATE VIEW existencias AS
          SELECT p.id AS producto_id, COALESCE(SUM(m.cantidad), 0) AS stock
          FROM productos p LEFT JOIN movimientos m ON m.producto_id = p.id
          GROUP BY p.id;

        CREATE TABLE usuarios (
          id {{pk}},
          nombre TEXT NOT NULL,
          rol TEXT NOT NULL CHECK (rol IN ('dueno','empleado')),
          pin_hash TEXT NOT NULL,
          activo INTEGER NOT NULL DEFAULT 1,
          creado_en TEXT NOT NULL DEFAULT {{ahora}}
        );

        CREATE TABLE configuracion (clave TEXT PRIMARY KEY, valor TEXT NOT NULL);
        INSERT INTO configuracion (clave, valor) VALUES ('nombre_negocio', 'Mi tienda'), ('moneda', 'MXN'), ('requerir_pin', '0');
      `,
    },
    {
      // Acceso con usuario y contraseña; el PIN queda para cambiar de cajero ('' = sin PIN).
      // Usuarios anteriores (sin usuario/contraseña) entran una vez con su nombre y su PIN y definen ambos.
      version: 2,
      sql: `
        ALTER TABLE usuarios ADD COLUMN usuario TEXT;
        ALTER TABLE usuarios ADD COLUMN password_hash TEXT;
        CREATE UNIQUE INDEX usuarios_usuario ON usuarios(usuario);
      `,
    },
  ],
};
