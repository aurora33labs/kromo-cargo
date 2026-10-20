# Seguridad

## Reportar una vulnerabilidad

Escríbenos a **hola@aurora33.app** con el asunto "Seguridad Kromo Cargo", o usa *Security → Report a vulnerability* en GitHub. No abras un issue público. Respondemos en un máximo de 5 días hábiles.

## Modelo de seguridad

**Modo local** (la computadora de la tienda):
- La app escucha solo en `127.0.0.1`. La API exige la cabecera `x-kromo` y valida `Origin` y `Host`, contra CSRF y *DNS rebinding*.
- Iniciar sesión es opcional: quien usa la computadora es dueño de los datos. La IA local se conecta por stdio con los permisos del usuario del sistema.

**Modo servidor** (Railway y Docker):
- Inicio de sesión obligatorio con usuario y contraseña (8+ caracteres), guardados con Argon2 (`Bun.password`). Un usuario que no existe tarda lo mismo en responder que una contraseña incorrecta.
- **Primer registro:** sin usuarios, la primera persona que abre la app crea la cuenta del dueño. El alta es atómica (dos registros simultáneos no crean dos dueños) y después se cierra para siempre. Riesgo aceptado: entre el despliegue y el registro, quien conozca la dirección (aleatoria en Railway) podría registrarse antes; por eso hay que crear la cuenta al terminar de desplegar. `KROMO_PIN_INICIAL` evita esa ventana en despliegues automatizados.
- **PIN de caja:** solo funciona en un navegador marcado como equipo de la tienda (cookie `HttpOnly` de 30 días, creada al entrar con contraseña). Los PIN son únicos por persona y comparten el límite de intentos.
- Siempre queda al menos un dueño activo. Cambiar la contraseña, el PIN, el nombre o el rol de alguien cierra sus sesiones.
- **Dominio propio:** solo un dueño lo configura. Se agrega a los hosts permitidos y pasa a ser la URL pública de OAuth y de las cookies.
- Intentos limitados: 5 fallos por IP y 20 globales cada 10 minutos. Las IP que ya entraron con éxito no se bloquean por el límite global.
- Sesiones en cookie `HttpOnly`, `SameSite=Strict` y `Secure`, de 12 horas. Los tokens de sesión, acceso, OAuth y refresh se guardan solo como hash SHA-256.
- OAuth 2.1 con PKCE S256 obligatorio, `redirect_uri` exacta y refresh con rotación. La página de autorización muestra el dominio real que recibirá el acceso y advierte cuando no es Claude ni ChatGPT.
- Una IA remota no puede leer archivos del servidor. Los archivos generados se entregan con enlaces firmados (HMAC-SHA256) que caducan en 1 hora.
- Cabeceras `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `Permissions-Policy`, HSTS (con https) y Content-Security-Policy en la UI (solo recursos propios); la UI se niega a mostrarse dentro de un iframe.
- Los respaldos descargables solo los crea un dueño; sin enlace firmado, solo un dueño los puede bajar.

**Acciones de la IA:** nada se borra (el stock es un libro de movimientos), todo queda en el historial con quién lo hizo, se puede deshacer y los cambios grandes piden confirmación con vista previa. Esto limita el daño de una IA que se equivoca o que recibe instrucciones maliciosas escondidas en datos (por ejemplo, en un CSV importado).

**Distribución:** el instalador y `kromo-cargo actualizar` verifican el SHA-256 de cada binario. Los releases de repos públicos llevan atestación de procedencia de GitHub: `gh attestation verify <binario> --repo aurora33labs/kromo-cargo`.
