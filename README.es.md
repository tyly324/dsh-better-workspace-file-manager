# Gestor de archivos del espacio de trabajo (mejorado)

[English](README.md) · [简体中文](README.zh.md) · [日本語](README.ja.md) · **Español** · [Français](README.fr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md) · [Português](README.pt.md)

> **Nota del fork (tyly324):** este repositorio es un fork de [Arrosam/dsh-better-workspace-file-manager](https://github.com/Arrosam/dsh-better-workspace-file-manager). Añade confirmación del destino de subida, progreso y reintento, cierre automático del diálogo de borrado, y operaciones como cortar/copiar/pegar, renombrar, comprimir/extraer ZIP, propiedades y nueva carpeta. Misma licencia MIT que el original.

Gestor de archivos para la pestaña **Archivos** de DSH Web y el panel de vista previa. Añade las operaciones de escritura que faltan en el árbol oficial sin modificar su DOM.

## Funciones

- **Subida** por botón, arrastrando desde el equipo o soltando una carpeta. Primero confirma la carpeta de destino (la seleccionada o la raíz del espacio de trabajo), luego muestra progreso por archivo, el motivo del fallo y **Reintentar**.
- **Selección múltiple** con clic, ⌘/Ctrl+clic, Mayús+clic o arrastrando sobre el espacio vacío.
- **Descarga** de un archivo, una selección o una carpeta completa como ZIP en streaming.
- **Nueva carpeta** desde el menú contextual o el botón de la cabecera; crea en la última carpeta seleccionada o en la raíz.
- **Eliminar** tras confirmar. El diálogo se cierra siempre al terminar; si la fila ya no existía, se cierra y se actualiza la lista.
- **Cortar / copiar / pegar / renombrar**: si el nombre ya existe se usa `name (1).ext`, nunca se sobrescribe.
- **Comprimir / extraer ZIP**: antes de extraer se validan `..`, rutas absolutas, enlaces simbólicos y archivos cifrados.
- **Propiedades**: nombre, tipo, tamaño (número de elementos en carpetas), fecha de modificación, permisos y ruta absoluta.
- **Mover arrastrando / arrastrar al chat**: suelta sobre una carpeta para mover; suelta en el cuadro de texto para añadir una referencia `@path`.
- **Vista previa**: descarga desde cada vista; edición en el sitio de texto/código/Markdown conservando saltos de línea y BOM, con detección de conflictos y guardado manual o automático cada 5 s.

## Instalación

```sh
dsh plugin --profile web add @tyly324/dsh-better-workspace-file-manager
```

Requisitos: perfil **Web** de DSH **0.2.1-rc.3 o superior** (probado con 0.2.2-rc.1), sistema de archivos local del Host (fs-local / fs-sandbox) y Node.js 20.15+.

## Notas y límites

- Solo **ZIP** estándar; no se admiten ZIP64, ZIP cifrado, 7z ni rar.
- 2 GiB por archivo/archivo comprimido y 10 000 entradas como máximo; para trabajos mayores usa la terminal.
- El borrado es **permanente**, sin papelera.
- El portapapeles de archivos vive solo en la página actual y se vacía al recargar.
- El tamaño de una carpeta muestra el número de elementos directos, no el total recursivo.

## Licencia

MIT, basado en Arrosam/dsh-better-workspace-file-manager. La documentación completa en inglés está en [README.md](README.md).
