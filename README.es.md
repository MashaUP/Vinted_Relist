# Vinted Relist

[🇮🇹 Italiano](README.md) · [🇬🇧 English](README.en.md) · [🇫🇷 Français](README.fr.md) · **🇪🇸 Español** · [🇩🇪 Deutsch](README.de.md)

Extensión para **Brave y Chrome** que republica tus anuncios de Vinted con un clic, de uno en uno
o en cola, para devolverlos a lo más alto de los resultados sin rehacerlos a mano.

**Versión 2.7.1** · [Novedades (en italiano)](CHANGELOG.md) · [Comunidad en Discord](https://discord.gg/EPsbQCuAkx) ·
[Informar de un problema](https://github.com/MashaUP/Vinted_Relist/issues/new?template=segnalazione-bug.yml) ·
[Apoya el desarrollo en Ko-fi](https://ko-fi.com/mashaup)

> [!WARNING]
> **Proyecto no oficial, úsalo bajo tu responsabilidad.** No está afiliado ni aprobado por
> Vinted, y automatizar acciones en el sitio puede no estar permitido por las condiciones de
> Vinted, que puede limitar o suspender cuentas. **El autor no se hace responsable** de lo que le
> pase a tu cuenta, de anuncios perdidos o eliminados, de ventas perdidas ni de abusos o usos
> indebidos de la extensión. Republicar **elimina** el anuncio antiguo: las visitas y los favoritos
> vuelven a cero. Al instalarla aceptas el [aviso legal completo](DISCLAIMER.md#español).

---

## Para quién es

Para quien vende en Vinted desde su propio armario y republica a menudo los mismos artículos:
libros, manga, ropa, lotes. En lugar de copiar fotos y textos en un anuncio nuevo y borrar el
antiguo, pulsa **Republicar** en la tarjeta del artículo, o selecciona varios y ponlos en una
**cola** con una pausa entre uno y otro.

Es un proyecto personal, gratuito y sin servidor: todo se queda en tu navegador. La interfaz está
en **italiano, inglés, francés, español y alemán**.

Se distribuye como zip en GitHub y se carga como extensión sin empaquetar — **no está en la Chrome
Web Store**. **Pruébala primero con un artículo poco importante.**

## Instalación

1. Descarga **`Vinted_Relist-2.7.1.zip`** desde la
   [página de versiones en GitHub](https://github.com/MashaUP/Vinted_Relist/releases) (en
   «Assets») o desde la raíz del repositorio.
2. Extráelo **en una carpeta permanente**, por ejemplo `Documentos\Vinted_Relist` (no en la
   carpeta temporal que Windows abre al hacer doble clic en el zip). La carpeta correcta es la que
   contiene `manifest.json`.
3. Abre `brave://extensions` (o `chrome://extensions`) y activa el **Modo de desarrollador**
   (arriba a la derecha).
4. **Cargar descomprimida** › elige la carpeta que contiene `manifest.json`.
5. Abre tu armario en Vinted **con la sesión iniciada** y recarga la página: en las tarjetas
   aparecen los botones **Republicar** y **Editar**.

> No borres ni muevas la carpeta después de instalarla: el navegador la usa cada vez.

### Actualizar

1. Popup › **Estado** › **Buscar actualización** (también lo comprueba sola cada 12 horas y te
   avisa).
2. **Descarga el zip**: el popup comprueba su huella SHA-256 y lo guarda en Descargas › Vinted
   Relist. Extráelo **en la carpeta que contiene `Vinted_Relist`**, sustituyendo los archivos (el zip
   ya contiene la carpeta `Vinted_Relist/`).
3. **Instalar la actualización**: la extensión se recarga. Después recarga las pestañas de Vinted
   (F5).

## Guía rápida

**0. Idioma.** El botón 🌐 en la parte superior del popup y del panel abre el panel **Idioma**:
«Automático» sigue el idioma del navegador, o elige Italiano, English, Français, Español o
Deutsch. El cambio se aplica en todas partes al momento.

**1. Un artículo.** En una tarjeta de tu armario:
- **Republicar**: clona el anuncio y borra el antiguo, al momento;
- **Editar**: primero cambias fotos, título, descripción o precio, ves la vista previa de los
  cambios y luego publicas.

**2. Muchos artículos (cola).** Marca las casillas de las tarjetas (Mayús+clic para un intervalo) ›
**Cola** › elige las opciones (precio, textos, intervalo entre artículos, hora de inicio) › el
control lee cada artículo **sin publicar** y los separa en listos, con avisos y bloqueados ›
**Iniciar**. Mantén abierta una pestaña de Vinted mientras la cola trabaja.

**3. Con la cola en marcha.** Sigue seleccionando artículos y pulsa **Añadir a la cola**: se abre
el **Centro de edición** y pasan a ser un **lote** nuevo con sus propias reglas e intervalo. La
cola no se detiene. **Gestionar** abre la página de la cola, donde puedes ver, reordenar, pausar y
corregir todo.

**4. Anuncios ya eliminados por Vinted.** Con [Vintory](https://github.com/MashaUP/Vintory)
exporta los anuncios («Para Vinted_Relist») y luego Panel › **Republicar desde Vintory** › elige
el ZIP: la vista previa te indica cuáles se pueden republicar, sin eliminar nada.

**5. Si algo sale mal.** Popup › **Estado**: estado de la extensión, diagnóstico para copiar y qué
hacer. Un resultado incierto pasa a «por verificar» y nunca se republica solo.

## Qué hace

- **Republicación:** clona el anuncio (fotos, título, descripción, categoría, marca, talla,
  estado, colores, modelo en los teléfonos, precio, envío) y borra el antiguo, con las API
  internas del sitio y tu sesión — sin clics simulados.
- **Orden seguro:** primero publica y luego elimina (predeterminado). Si Vinted rechaza el nuevo,
  el antiguo se queda.
- **Ante la duda, no republica:** sin una respuesta clara de Vinted el artículo pasa a «por
  verificar» y lo confirmas tú (también con **Verificar publicación**, que mira en Vinted sin
  publicar nada).
- **Solo tus anuncios:** los botones solo aparecen en tu armario; los artículos vendidos nunca se
  republican.
- **Editor del anuncio:** reordenar, girar, recortar y quitar fotos; título, descripción, precio,
  color; controles en tiempo real y puntuación de completitud; descarga de las fotos originales.
- **Cola:** añadir, quitar y reordenar incluso mientras trabaja; lotes con sus propias reglas e
  intervalo; marcadores de estado en las tarjetas; pausa temporizada; «Republicar ahora»; opciones
  en bloque (precio en %, en euros o fijo, buscar y sustituir, línea al final de la descripción);
  protecciones frente a los límites de Vinted; historial y exportación CSV/JSON.
- **Panel:** gestión de la cola, grupos de artículos (recientes, estancados, por optimizar…),
  posibles duplicados, qué funciona (visitas a las 48 h por día y franja), historial con
  comparación antes/después y restauración, **Republicar desde Vintory**.

## Consejos: cuándo republicar

- **Entre artículos distintos, 15–20 minutos** (el intervalo predeterminado de la cola). Pocos
  artículos cada vez, pausas generosas.
- **El mismo artículo cada 5–7 días, nunca todos los días.**
- **El domingo por la noche, 20:00–22:00** suele ser el mejor momento; el **viernes** el peor día;
  evita la franja 1:00–6:00.

Estas cifras vienen de vendedores de herramientas de republicación ([Relisted](https://relisted.io/en/blog/best-time-post-vinted),
[Vinkit](https://vinkit.co/it/blog/con-quale-frequenza-ripubblicare-annunci-vinted-studio-24m-articoli))
y no son verificables; tras unas semanas, el panel te muestra qué funciona en tu armario.

## Si algo no va

Popup › **Estado** › **Preparar el diagnóstico**: versión, ajustes, estado de la cola y errores
recientes, sin tokens, cookies, ids ni direcciones. Lo ves antes de copiarlo y puedes pegarlo en
Discord o en un informe de error.

- **No aparecen los botones / «Perfil no detectado».** Solo aparecen en tu armario
  (`/member/<tu id>`) cuando la extensión ha reconocido tu cuenta. Recarga una pestaña de Vinted
  (F5) con la sesión iniciada: las pestañas abiertas antes de instalar o actualizar la extensión no
  cuentan. En Estado, **«Solicitudes de Vinted»** indica cuándo vio la extensión Vinted por última
  vez y si estaba la cookie de la cuenta; si dice «formato nuevo», envíanos el diagnóstico.
- **«Recarga esta página» tras una actualización.** Recarga la pestaña de Vinted (F5): las páginas
  ya abiertas siguen con el código antiguo.
- **Errores de sesión** (desde la 2.7.1 el mensaje dice cuál). En Estado, la fila **«Sesión»**
  indica si la pestaña de Vinted está lista. «Sesión caducada»: vuelve a iniciar sesión en Vinted en
  esa pestaña. «Token no encontrado en ninguna forma conocida»: quizá Vinted ha cambiado la página,
  envíanos el diagnóstico en Discord. Un perfil detectado no basta para publicar.
- **Teléfonos: Vinted pide seleccionar el modelo.** Desde la 2.6 el modelo se copia solo. Si
  vuelve a pasar: abre el anuncio en Vinted › **Editar** › comprueba el modelo › guarda, y vuelve
  a intentarlo (la extensión aprende los campos de esa categoría). Si no basta, envíanos el
  diagnóstico.
- **La cola se detiene con «Problema de la extensión».** El motivo aparece en la pausa y en el
  diagnóstico. Normalmente basta con recargar la pestaña de Vinted; luego **Reanudar**. No se
  había enviado nada a Vinted.
- **Error 403 o 429.** Es la protección antibot de Vinted: la cola se ralentiza sola. Aumenta el
  intervalo.
- **Icono roto, `ERR_FILE_NOT_FOUND`.** El navegador ya no encuentra la carpeta: extráela en una
  ubicación permanente y vuelve a cargar la extensión desde allí.

## Privacidad y permisos

Borradores, historial, estadísticas, cola y notificaciones se quedan en tu navegador. **Sin
telemetría, sin servidor, sin datos enviados al autor.** Las únicas solicitudes fuera de Vinted van
a GitHub, sin cookies ni datos personales: `version.json` para las actualizaciones y `links.json`
para los enlaces del proyecto (se desactiva en Ajustes › Avanzado).

| Permiso | Para qué sirve |
|---|---|
| `storage` | ajustes, cola, inventario, historial, notificaciones, idioma: todo en local |
| `webRequest` | leer de las solicitudes de Vinted el token de sesión, tu id y los formatos |
| `alarms` | despertar la cola a la hora correcta y reanudar una pausa temporizada |
| `notifications` | avisos de fin de cola y de actualizaciones |
| `idle` | ritmo irregular: ningún paso cuando no estás en el ordenador |
| `downloads` | fotos descargadas, copias de seguridad de los ajustes, exportaciones de la cola |
| sitios `vinted.*` y `*.vinted.net` | llamar a las API de Vinted y descargar las fotos de su CDN |

## Qué no hace

- No devuelve a la vida el anuncio original: visitas, favoritos y antigüedad vuelven a cero.
- No altera las fotos para esquivar los controles de Vinted.
- No funciona con el navegador cerrado: hace falta el navegador abierto y una pestaña de Vinted.
- No se actualiza sola: te avisa, y el zip lo extraes tú.

## Ayuda y apoyo

- **Preguntas y ayuda:** la [comunidad en Discord](https://discord.gg/EPsbQCuAkx).
- **Errores:** [abre un informe](https://github.com/MashaUP/Vinted_Relist/issues/new?template=segnalazione-bug.yml)
  con la versión, el navegador, qué ha pasado y el diagnóstico. **Nunca pegues cookies, tokens ni
  datos de la cuenta.**
- **Apoya el desarrollo:** Vinted Relist es gratuito; si te ahorra tiempo puedes invitarme a un
  café en [Ko-fi](https://ko-fi.com/mashaup).

La documentación técnica para desarrolladores está en italiano ([README](README.md#per-sviluppatori),
[docs/SVILUPPO.md](docs/SVILUPPO.md)).

## Licencia y aviso legal

[MIT](LICENSE): puedes usar, modificar y redistribuir el código, también en tus propios proyectos,
siempre que mantengas el aviso de copyright. El software se ofrece **tal cual, sin garantías**.

Vinted Relist es un proyecto independiente, **no afiliado ni aprobado por Vinted**. Úsalo bajo tu
responsabilidad: el autor no responde de suspensiones o bloqueos de la cuenta, anuncios perdidos,
ventas perdidas, ni de abusos o usos indebidos. Lee el [aviso legal completo](DISCLAIMER.md#español).
