# Seguridad

## Reportar una vulnerabilidad

Escríbenos a **hola@aurora33.app** con el asunto "Seguridad Kromo Cargo", o usa *Security → Report a vulnerability* en GitHub. No abras un issue público. Respondemos en un máximo de 5 días hábiles.

## Modelo de seguridad

**Modo local** (la computadora de la tienda):
- La app escucha solo en `127.0.0.1`. La API exige la cabecera `x-kromo` y valida `Origin` y `Host`, contra CSRF y *DNS rebinding*.
- El PIN es opcional: quien usa la computadora es dueño de los datos. La IA local se conecta por stdio con los permisos del usuario del sistema.

**Modo servidor** (Railway):
- PIN obligatorio de 6 a 12 dígitos, guardado con Argon2 (`Bun.password`). El primer dueño se crea con `KROMO_PIN_INICIAL`; sin esa variable la app no arranca.
- Intentos limitados: 5 fallos por IP y 20 globales cada 10 minutos. Las IP que ya entraron con éxito no se bloquean por el límite global.
- Sesiones en cookie `HttpOnly`, `SameSite=Strict` y `Secure`, de 12 horas. Los tokens de sesión, acceso, OAuth y refresh se guardan solo como hash SHA-256.
- OAuth 2.1 con PKCE S256 obligatorio, `redirect_uri` exacta y refresh con rotación. La página de autorización muestra el dominio real que recibirá el acceso y advierte cuando no es Claude ni ChatGPT.
- Una IA remota no puede leer archivos del servidor. Los archivos generados se entregan con enlaces firmados (HMAC-SHA256) que caducan en 1 hora.
- Cabeceras `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` y `X-Frame-Options: DENY`; la UI se niega a mostrarse dentro de un iframe.

**Acciones de la IA:** nada se borra (el stock es un libro de movimientos), todo queda en el historial con quién lo hizo, se puede deshacer y los cambios grandes piden confirmación con vista previa. Esto limita el daño de una IA que se equivoca o que recibe instrucciones maliciosas escondidas en datos (por ejemplo, en un CSV importado).

**Distribución:** el instalador y `kromo-cargo actualizar` verifican el SHA-256 de cada binario. Los releases de repos públicos llevan atestación de procedencia de GitHub: `gh attestation verify <binario> --repo aurora33labs/kromo-cargo`.
