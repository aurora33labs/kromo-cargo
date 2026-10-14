---
name: kromo-cargo
description: Opera el inventario y las ventas de una tienda física a través del MCP "kromo-cargo" (productos, stock, ventas, entradas, mermas, reportes, etiquetas QR, importación). Úsala cuando la persona pregunte por su inventario, qué se le acaba, cuánto vendió, quiera dar de alta productos (incluso desde fotos), registrar mercancía, cambiar precios o imprimir etiquetas.
---

# Inventario de la tienda

Tienes acceso al MCP `kromo-cargo`. La misma base la usa el personal en la app (`kromo-cargo serve`), así que todo lo que hagas aparece en vivo en su pantalla y queda en el historial con tu nombre.

## Antes de actuar
- Si no tienes contexto, llama `resumen`: ventas de hoy, valor del inventario y lo que está por agotarse.
- Para modificar algo, primero ubícalo con `buscar_productos` y usa su `id`.
- Montos en pesos mexicanos. Responde breve, en español, con números concretos y tablas cuando haya varias filas.

## Reglas
1. **Nunca se borra.** Para quitar un producto: `actualizar_producto` con `activo: false`.
2. **El stock solo se mueve con:** `registrar_entrada` (llegó mercancía), `registrar_venta` (se vendió) o `ajustar_stock` (merma, corrección o conteo, siempre con motivo). `actualizar_producto` no cambia stock.
3. **Confirmación en dos pasos.** Si la respuesta trae `requiere_confirmacion`, muestra la `vista_previa` como tabla, pregunta, y solo con un "sí" explícito vuelve a llamar con los mismos datos + `token_confirmacion`.
4. **Errores propios:** si te equivocas, `historial` → `deshacer` con el `historial_id`. Avísale a la persona.

## Flujos frecuentes

### "¿Qué se me acaba?" / "¿Qué pido al proveedor?"
`productos_stock_bajo` (por defecto 7 días). Agrupa por proveedor y muestra `sugerido_pedir`. Ofrece armar el pedido como texto para WhatsApp.

### Alta de productos desde fotos
1. Mira cada imagen. Propón por foto: nombre corto y comercial (marca + presentación, p. ej. "Coca-Cola 600 ml"), categoría y una descripción de una línea. Si ves un código de barras legible, inclúyelo.
2. Pregunta precio (y costo/stock si los sabe) en una sola tabla para todas las fotos.
3. Llama `crear_producto` por cada una con `foto_path` = la ruta local de la imagen.
4. Ofrece `generar_etiquetas` con los ids nuevos.

### Llegó mercancía
`registrar_entrada` con todas las líneas en una sola llamada, el proveedor y el costo si cambió. Después ofrece etiquetas con `solo_entradas_de_hoy: true`.

### Cambio de precios
`actualizar_precios_masivo` con filtro (categoría, ids o texto) y `redondeo: "peso"` salvo que pidan centavos. Siempre muestra la vista previa.

### Cierre del día / reporte
`reporte_ventas` con `desde` y `hasta` = hoy; luego por `producto`. Menciona ticket promedio, utilidad estimada y lo más vendido. Si hay productos por agotarse, dilo al final.

### Conteo físico
`ajustar_stock` con `tipo: "conteo"` y `stock_real`. Para muchos productos, sugiere exportar (`exportar_productos`), contar en Excel e importar (`importar_productos`): la columna de existencias se toma como conteo.

### Importar un catálogo existente
`importar_productos` con la ruta del CSV/XLSX. Explica la vista previa (nuevos, actualizados, filas con error) antes de confirmar.

## La app
Si la persona quiere ver la pantalla, `resumen.app` dice si está abierta y su URL. Si no, indícale correr `kromo-cargo serve`.
